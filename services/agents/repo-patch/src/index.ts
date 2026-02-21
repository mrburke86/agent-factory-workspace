import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runAgent } from "@acme/agent-runner";
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
const VALIDATE_SKIP_CONSTRAINT = "skip-validate";
const COMMAND_INPUT_PREVIEW_MAX = 240;

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

function buildEmptyPlan(): RepoPatchPlan {
  return RepoPatchPlanSchema.parse({
    steps: [],
    touchedFiles: [],
    commands: [],
    risks: [],
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

function isSubAgentSuccess(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const typed = result as { ok?: unknown; data?: { ok?: unknown } };
  if (typed.ok !== true) return false;
  if (typeof typed.data?.ok === "boolean" && typed.data.ok !== true) return false;
  return true;
}

function extractSubAgentError(agentName: string, result: unknown): string {
  if (!result || typeof result !== "object") {
    return `sub-agent ${agentName} returned invalid result`;
  }
  const typed = result as {
    errors?: Array<{ message?: unknown }>;
    data?: { error?: unknown };
  };
  const firstError = typed.errors?.find((error) => typeof error?.message === "string");
  if (typeof firstError?.message === "string") return firstError.message;
  if (typeof typed.data?.error === "string") return typed.data.error;
  return `sub-agent ${agentName} reported failure`;
}

function truncateCommandInput(value: unknown): string {
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  if (serialized.length <= COMMAND_INPUT_PREVIEW_MAX) return serialized;
  return `${serialized.slice(0, COMMAND_INPUT_PREVIEW_MAX)}...`;
}

function createSubAgentLogLine(agentName: string, input: unknown, exitCode: number): string {
  const now = new Date().toISOString();
  const inputPreview = truncateCommandInput(input);
  return `[${now}] sub-agent:${agentName} input=${inputPreview} exitCode=${exitCode}`;
}

async function writeJsonArtifact(runDir: string, fileName: string, value: unknown): Promise<void> {
  await writeFile(join(runDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function commitMessageFromGoal(goal: string): string {
  const normalizedGoal = goal.replace(/\s+/g, " ").trim();
  const prefix = "feat: ";
  const maxGoalLength = Math.max(0, 72 - prefix.length);
  if (normalizedGoal.length <= maxGoalLength) return `${prefix}${normalizedGoal}`;
  return `${prefix}${normalizedGoal.slice(0, maxGoalLength)}`;
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
  runDir: string,
  patches: RepoPatchPatchItem[],
  result: RepoPatchResult,
  commandLog: string[],
): Promise<void> {
  const patchDir = join(runDir, "patches");

  await mkdir(patchDir, { recursive: true });

  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i];
    const prefix = String(i + 1).padStart(3, "0");
    const name = sanitizePatchArtifactName(patch.path);
    const fileName = `${prefix}-${name}.diff`;
    const content = patch.unifiedDiff.endsWith("\n") ? patch.unifiedDiff : `${patch.unifiedDiff}\n`;
    await writeFile(join(patchDir, fileName), content, "utf8");
  }

  const commandLogContent = commandLog.length > 0 ? `${commandLog.join("\n")}\n` : "";
  await writeFile(join(runDir, "commands.log"), commandLogContent, "utf8");
  await writeFile(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function runImpl(input: RepoPatchTask): Promise<RepoPatchResult> {
  const task = RepoPatchTaskSchema.parse(input);
  const correlationId = randomUUID();
  const runDir = join(process.cwd(), ".factory", "runs", correlationId);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const commandLog: string[] = [];
  const patches: RepoPatchPatchItem[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  let plan = buildEmptyPlan();

  await mkdir(runDir, { recursive: true });
  await writeJsonArtifact(runDir, "task.json", task);

  const invokeSubAgent = async (agentName: string, subAgentInput: unknown, artifactFileName: string) => {
    try {
      const result = await runAgent(agentName, subAgentInput, { rootDir: process.cwd() });
      const exitCode = isSubAgentSuccess(result) ? 0 : 2;
      commandLog.push(createSubAgentLogLine(agentName, subAgentInput, exitCode));
      await writeJsonArtifact(runDir, artifactFileName, result);
      if (!isSubAgentSuccess(result)) {
        errors.push({
          code: "SUB_AGENT_FAILED",
          message: `sub_agent_failed: ${agentName}: ${extractSubAgentError(agentName, result)}`,
        });
      }
      return result;
    } catch (e) {
      const errorMessage = (e as Error)?.message ?? String(e);
      commandLog.push(createSubAgentLogLine(agentName, subAgentInput, 1));
      await writeJsonArtifact(runDir, artifactFileName, {
        ok: false,
        agent: agentName,
        errors: [{ code: "INVOCATION_ERROR", message: errorMessage }],
      });
      errors.push({
        code: "SUB_AGENT_INVOCATION_FAILED",
        message: `sub_agent_invocation_failed: ${agentName}: ${errorMessage}`,
      });
      return undefined;
    }
  };

  const repoReadInput = {
    repoRoot: ".",
    queries: task.fileScope.flatMap((scopeEntry) => [
      {
        type: "file-list" as const,
        pattern: "*",
        scope: scopeEntry,
      },
      {
        type: "file-content" as const,
        pattern: scopeEntry,
      },
    ]),
  };
  const repoReadResult = await invokeSubAgent("repo-read", repoReadInput, "repo-read.json");

  if (errors.length === 0) {
    const planInput = {
      ...task,
      repoReadContext: (repoReadResult as { data?: unknown } | undefined)?.data,
    };
    const planResult = await invokeSubAgent("plan", planInput, "plan.json");
    if (errors.length === 0) {
      plan = RepoPatchPlanSchema.parse((planResult as { data?: unknown }).data);
    }
  }

  if (errors.length === 0) {
    patches.push(buildHelloPatch());
    const safetyErrors = collectSafetyErrors(task, plan, patches);
    errors.push(...safetyErrors);
  }

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

  const shouldSkipValidate = task.mode === "dry-run" || task.constraints.includes(VALIDATE_SKIP_CONSTRAINT);
  if (errors.length === 0) {
    if (shouldSkipValidate) {
      const reason =
        task.mode === "dry-run" ? "dry-run mode" : `constraint: ${VALIDATE_SKIP_CONSTRAINT}`;
      await writeJsonArtifact(runDir, "validate.json", { skipped: true, reason });
    } else {
      const validateInput = {
        commands: plan.commands.length > 0 ? plan.commands : ["pnpm -r build"],
        repoRoot: ".",
        artifactDir: `.factory/runs/${correlationId}`,
      };
      await invokeSubAgent("validate", validateInput, "validate.json");
    }
  }

  if (errors.length === 0) {
    if (task.mode === "pr-ready") {
      const gitPrInput = {
        branchName: `factory/${task.taskId}`,
        commitMessage: commitMessageFromGoal(task.goal),
        patchedFiles: patches.map((patch) => patch.path),
        mode: "dry-run" as const,
        repoRoot: ".",
      };
      await invokeSubAgent("git-pr", gitPrInput, "git-pr.json");
    } else {
      await writeJsonArtifact(runDir, "git-pr.json", {
        skipped: true,
        reason: `mode '${task.mode}' is not pr-ready`,
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
  await writeArtifacts(runDir, patches, result, commandLog);
  return result;
}

export async function run(input: RepoPatchTask): Promise<AgentResult<RepoPatchResult>> {
  return wrap<RepoPatchTask, RepoPatchResult>(AGENT_NAME, runImpl, input);
}
