import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  RepoPatchPatchItemSchema,
  RepoPatchPlanSchema,
  RepoPatchResultSchema,
  RepoPatchTaskSchema,
  type RepoPatchPatchItem,
  type RepoPatchPlan,
  type RepoPatchResult,
  type RepoPatchTask,
} from "@acme/contracts";
import { wrap, type AgentResult } from "@acme/agent-runtime";

const AGENT_NAME = "repo-patch";
const HELLO_FILE_PATH = "hello.txt";
const HELLO_FILE_CONTENT = "hello world\n";
const DEFAULT_MAX_FILES = 10;
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
const ALLOW_LOCKFILE_CHANGES = "allow-lockfile-changes";
const MAX_FILES_CONSTRAINT_PREFIX = "max-files:";

type CommandLogEntry = {
  command: string;
  exitCode: number;
};

type ResultTimings = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").trim();
}

export function isPathInScope(targetPath: string, fileScope: string[]): boolean {
  const normalizedTarget = normalizePath(targetPath);
  for (const scopeEntry of fileScope) {
    const normalizedScope = normalizePath(scopeEntry);
    if (normalizedScope.length === 0) continue;
    if (normalizedTarget === normalizedScope) return true;
    if (normalizedScope.endsWith("/")) {
      if (normalizedTarget.startsWith(normalizedScope)) return true;
      continue;
    }
    if (normalizedTarget.startsWith(`${normalizedScope}/`)) return true;
  }
  return false;
}

function readMaxFiles(constraints: string[]): number {
  for (const constraint of constraints) {
    if (!constraint.startsWith(MAX_FILES_CONSTRAINT_PREFIX)) continue;
    const raw = constraint.slice(MAX_FILES_CONSTRAINT_PREFIX.length);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return DEFAULT_MAX_FILES;
}

function isAllowlistedCommand(command: string): boolean {
  const cmd = command.trim();
  if (cmd === "pnpm -r build") return true;
  if (cmd === "pnpm factory:health") return true;
  if (/^pnpm -C \S+ \S+$/.test(cmd)) return true;
  if (/^pnpm af \S+(?: .+)?$/.test(cmd)) return true;
  return false;
}

function buildPlan(task: RepoPatchTask, touchedFiles: string[]): RepoPatchPlan {
  const steps = [
    "parse goal",
    "create patch",
    task.mode === "dry-run" ? "skip apply (dry-run)" : "apply patch",
  ];
  return RepoPatchPlanSchema.parse({
    steps,
    touchedFiles,
    commands: [],
    risks: ["writes new file"],
  });
}

function buildHelloPatch(): RepoPatchPatchItem {
  const unifiedDiff = [
    "--- /dev/null",
    "+++ b/hello.txt",
    "@@ -0,0 +1 @@",
    "+hello world",
    "",
  ].join("\n");
  return RepoPatchPatchItemSchema.parse({
    path: HELLO_FILE_PATH,
    unifiedDiff,
    rationale: "Create hello.txt with deterministic acceptance fixture content.",
  });
}

async function applyPatches(task: RepoPatchTask, patches: RepoPatchPatchItem[]): Promise<void> {
  if (task.mode === "dry-run") return;

  for (const patch of patches) {
    if (patch.path !== HELLO_FILE_PATH) {
      throw new Error(`unsupported patch path: ${patch.path}`);
    }
  }

  const repoRoot = resolve(process.cwd());
  for (const patch of patches) {
    const targetFile = resolve(repoRoot, patch.path);
    const targetDir = dirname(targetFile);
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetFile, HELLO_FILE_CONTENT, "utf8");
  }
}

function collectSafetyErrors(task: RepoPatchTask, plan: RepoPatchPlan, patches: RepoPatchPatchItem[]) {
  const errors: Array<{ code: string; message: string }> = [];
  const uniquePaths = new Set<string>();
  const allowLockfileChanges = task.constraints.includes(ALLOW_LOCKFILE_CHANGES);

  for (const patch of patches) {
    const normalizedPath = normalizePath(patch.path);
    uniquePaths.add(normalizedPath);

    if (!isPathInScope(normalizedPath, task.fileScope)) {
      errors.push({
        code: "SCOPE_VIOLATION",
        message: `scope_violation: patch path '${patch.path}' not in fileScope`,
      });
    }

    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    if (LOCKFILES.has(fileName) && !allowLockfileChanges) {
      errors.push({
        code: "LOCKFILE_PROTECTED",
        message: `lockfile_protected: refusing to modify ${fileName} without allow-lockfile-changes`,
      });
    }
  }

  const maxFiles = readMaxFiles(task.constraints);
  if (uniquePaths.size > maxFiles) {
    errors.push({
      code: "MAX_FILES_EXCEEDED",
      message: `max_files_exceeded: ${uniquePaths.size} > ${maxFiles}`,
    });
  }

  for (const command of plan.commands) {
    if (!isAllowlistedCommand(command)) {
      errors.push({
        code: "COMMAND_NOT_ALLOWLISTED",
        message: `command_not_allowlisted: ${command}`,
      });
    }
  }

  return errors;
}

function buildResult(
  correlationId: string,
  plan: RepoPatchPlan,
  patches: RepoPatchPatchItem[],
  errors: Array<{ code: string; message: string }>,
  timings: ResultTimings,
): RepoPatchResult {
  return RepoPatchResultSchema.parse({
    ok: errors.length === 0,
    correlationId,
    timings,
    outputs: [
      {
        key: "plan",
        value: plan,
      },
      {
        key: "patches",
        value: patches,
      },
    ],
    errors,
  });
}

function sanitizePatchArtifactName(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const baseName = normalized.split("/").pop() ?? "patch";
  const sanitized = baseName.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "patch";
}

async function writeArtifacts(
  correlationId: string,
  task: RepoPatchTask,
  plan: RepoPatchPlan,
  patches: RepoPatchPatchItem[],
  result: RepoPatchResult,
  commandLog: CommandLogEntry[],
): Promise<void> {
  const runDir = join(process.cwd(), ".factory", "runs", correlationId);
  const patchDir = join(runDir, "patches");

  await mkdir(patchDir, { recursive: true });

  await writeFile(join(runDir, "task.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await writeFile(join(runDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i];
    const prefix = String(i + 1).padStart(3, "0");
    const name = sanitizePatchArtifactName(patch.path);
    const fileName = `${prefix}-${name}.diff`;
    const content = patch.unifiedDiff.endsWith("\n") ? patch.unifiedDiff : `${patch.unifiedDiff}\n`;
    await writeFile(join(patchDir, fileName), content, "utf8");
  }

  await writeFile(join(runDir, "commands.log"), `${JSON.stringify(commandLog, null, 2)}\n`, "utf8");
  await writeFile(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function runImpl(input: RepoPatchTask): Promise<RepoPatchResult> {
  const task = RepoPatchTaskSchema.parse(input);
  const correlationId = randomUUID();
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const commandLog: CommandLogEntry[] = [];
  const patch = buildHelloPatch();
  const patches = [patch];
  const touchedFiles = patches.map((item) => item.path);
  const plan = buildPlan(task, touchedFiles);
  const errors = collectSafetyErrors(task, plan, patches);

  if (errors.length === 0) {
    try {
      await applyPatches(task, patches);
    } catch (e) {
      errors.push({
        code: "PATCH_APPLY_FAILED",
        message: `patch_apply_failed: ${(e as Error)?.message ?? String(e)}`,
      });
    }
  }

  const finishedMs = Date.now();
  const timings: ResultTimings = {
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
  };

  const result = buildResult(correlationId, plan, patches, errors, timings);
  await writeArtifacts(correlationId, task, plan, patches, result, commandLog);
  return result;
}

export async function run(input: RepoPatchTask): Promise<AgentResult<RepoPatchResult>> {
  return wrap<RepoPatchTask, RepoPatchResult>(AGENT_NAME, runImpl, input);
}
