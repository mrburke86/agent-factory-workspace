import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import { nowIso, wrap, type AgentResult } from "@acme/agent-runtime";

const AGENT_NAME = "repo-patch";
const HELLO_FILE_PATH = "hello.txt";
const HELLO_FILE_CONTENT = "hello world\n";
const DEFAULT_MAX_FILES = 10;
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
const ALLOW_LOCKFILE_CHANGES = "allow-lockfile-changes";
const MAX_FILES_CONSTRAINT_PREFIX = "max-files:";

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

  const repoRoot = resolve(process.cwd());
  for (const patch of patches) {
    if (patch.path !== HELLO_FILE_PATH) {
      throw new Error(`unsupported patch path: ${patch.path}`);
    }

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
  task: RepoPatchTask,
  plan: RepoPatchPlan,
  patches: RepoPatchPatchItem[],
  errors: Array<{ code: string; message: string }>,
): RepoPatchResult {
  const startedAt = nowIso();
  const finishedAt = nowIso();
  return RepoPatchResultSchema.parse({
    ok: errors.length === 0,
    correlationId: task.taskId,
    timings: {
      startedAt,
      finishedAt,
      durationMs: 0,
    },
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

async function runImpl(input: RepoPatchTask): Promise<RepoPatchResult> {
  const task = RepoPatchTaskSchema.parse(input);
  const patch = buildHelloPatch();
  const patches = [patch];
  const touchedFiles = patches.map((item) => item.path);
  const plan = buildPlan(task, touchedFiles);
  const errors = collectSafetyErrors(task, plan, patches);

  if (errors.length > 0) {
    return buildResult(task, plan, patches, errors);
  }

  await applyPatches(task, patches);
  return buildResult(task, plan, patches, []);
}

export async function run(input: RepoPatchTask): Promise<AgentResult<RepoPatchResult>> {
  return wrap<RepoPatchTask, RepoPatchResult>(AGENT_NAME, runImpl, input);
}
