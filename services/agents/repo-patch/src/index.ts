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
const SUPPORTED_GOAL = "add hello.txt with content hello world";
const HELLO_FILE_CONTENT = "hello world\n";

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

async function runImpl(input: RepoPatchTask): Promise<RepoPatchResult> {
  const task = RepoPatchTaskSchema.parse(input);
  const normalizedGoal = task.goal.trim().toLowerCase();
  if (normalizedGoal !== SUPPORTED_GOAL) {
    throw new Error(`unsupported goal for D3a: ${task.goal}`);
  }

  const patch = buildHelloPatch();
  const patches = [patch];
  const touchedFiles = patches.map((item) => item.path);
  const plan = buildPlan(task, touchedFiles);

  await applyPatches(task, patches);

  const startedAt = nowIso();
  const finishedAt = nowIso();
  return RepoPatchResultSchema.parse({
    ok: true,
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
    errors: [],
  });
}

export async function run(input: RepoPatchTask): Promise<AgentResult<RepoPatchResult>> {
  return wrap<RepoPatchTask, RepoPatchResult>(AGENT_NAME, runImpl, input);
}
