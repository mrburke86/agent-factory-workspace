import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

type CheckResult = {
  id: string;
  passed: boolean;
  details?: unknown;
  error?: string;
};

type Report = {
  suiteName: string;
  passRate: number;
  count: number;
  results: CheckResult[];
};

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function loadFixture(pathValue: string): any {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function readJsonLines(pathValue: string): any[] {
  const raw = readFileSync(pathValue, "utf8").trim();
  if (raw.length === 0) {
    return [];
  }
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

async function loadOrchestratorRun(repoRoot: string): Promise<(input: unknown) => Promise<any>> {
  const entryPath = resolve(repoRoot, "services", "agents", "orchestrator", "dist", "index.js");
  if (!existsSync(entryPath)) {
    throw new Error(`missing built orchestrator agent: ${entryPath}. Did you run: pnpm -r build ?`);
  }
  const mod = await import(pathToFileURL(entryPath).href);
  if (typeof mod.run !== "function") {
    throw new Error(`orchestrator module missing run(): ${entryPath}`);
  }
  return mod.run as (input: unknown) => Promise<any>;
}

function createStageRunners(fixturesRoot: string, failingTaskId?: string): Record<string, (input: unknown) => Promise<unknown>> {
  const mockOutput = (name: string) => loadFixture(join(fixturesRoot, "mock-stage-outputs", `${name}.json`));

  return {
    "context-gather": async () => mockOutput("context-gather"),
    plan: async (input: any) => {
      if (failingTaskId && input?.taskId === failingTaskId) {
        throw new Error(`forced failure for ${failingTaskId}`);
      }
      return mockOutput("plan");
    },
    "repo-patch": async () => mockOutput("repo-patch"),
    validate: async () => mockOutput("validate"),
    "git-pr": async () => mockOutput("git-pr"),
    "error-recover": async () => ({
      diagnosis: "The failure is deliberate for the fixture and should not retry.",
      errorClass: "VALIDATION_FAILURE",
      recoveryAction: "escalate",
      shouldRetry: false,
      escalate: true,
      rationale: "Fixture failure propagation test uses a hard stop.",
    }),
  };
}

function buildOversizedTaskList(): { tasks: unknown[] } {
  return {
    tasks: Array.from({ length: 16 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      description: "Synthetic task for limit validation",
      dependsOn: index === 0 ? [] : [`task-${index}`],
      fileScope: [`src/file-${index + 1}.ts`],
      estimatedComplexity: "S",
    })),
  };
}

async function runScenario(options: {
  run: (input: unknown) => Promise<any>;
  taskList: unknown;
  l2Config: unknown;
  stageRunners: Record<string, (input: unknown) => Promise<unknown>>;
}): Promise<{
  result: any;
  runDir: string;
  progressEvents: any[];
  tempRepo: string;
}> {
  const tempRepo = mkdtempSync(join(tmpdir(), "af-orchestrator-multi-"));
  mkdirSync(join(tempRepo, "src"), { recursive: true });
  writeFileSync(join(tempRepo, "src", "health.ts"), "export function health() { return 'ok'; }\n", "utf8");
  writeFileSync(join(tempRepo, "src", "status.ts"), "export function status() { return 'ok'; }\n", "utf8");
  writeFileSync(join(tempRepo, "src", "routes.ts"), "export const routes = ['health'];\n", "utf8");

  const result = await options.run({
    taskList: options.taskList,
    l2Config: options.l2Config,
    repoRoot: tempRepo,
    _stageRunners: options.stageRunners,
  });

  const runDir = result?.data?.correlationId
    ? join(tempRepo, ".factory", "runs", result.data.correlationId)
    : "";
  const progressEvents = runDir.length > 0 && existsSync(join(runDir, "progress.jsonl"))
    ? readJsonLines(join(runDir, "progress.jsonl"))
    : [];

  return {
    result,
    runDir,
    progressEvents,
    tempRepo,
  };
}

async function main(): Promise<void> {
  const suiteName = "eval_orchestrator_multi";
  const evalRoot = process.cwd();
  const repoRoot = resolve(evalRoot, "..", "..");
  const singleFixtureRoot = resolve(evalRoot, "fixtures", "orchestrator");
  const multiFixtureRoot = resolve(evalRoot, "fixtures", "orchestrator-multi");
  const run = await loadOrchestratorRun(repoRoot);
  const taskList = loadFixture(join(multiFixtureRoot, "task-list.json"));
  const l2Config = loadFixture(join(singleFixtureRoot, "l2-config.json"));

  const successScenario = await runScenario({
    run,
    taskList,
    l2Config,
    stageRunners: createStageRunners(singleFixtureRoot),
  });

  const successData = successScenario.result?.data;
  const successTaskDirs = ["task-a", "task-b", "task-c"].filter((taskId) =>
    existsSync(join(successScenario.runDir, "tasks", taskId)),
  );
  const successEvents = successScenario.progressEvents.map((event) => `${event.event}:${event.taskId}`);

  const failureScenario = await runScenario({
    run,
    taskList,
    l2Config,
    stageRunners: createStageRunners(singleFixtureRoot, "task-a"),
  });

  const failureData = failureScenario.result?.data;
  const failureEvents = failureScenario.progressEvents.map((event) => `${event.event}:${event.taskId}`);
  const taskCResult = Array.isArray(failureData?.taskResults)
    ? failureData.taskResults.find((entry: any) => entry.taskId === "task-c")
    : undefined;

  const oversizedResult = await run({
    taskList: buildOversizedTaskList(),
    l2Config,
    repoRoot: repoRoot,
    _stageRunners: createStageRunners(singleFixtureRoot),
  });

  const results: CheckResult[] = [
    {
      id: "scenario-a-all-complete",
      passed:
        successScenario.result?.ok === true &&
        successData?.overallResult?.completedTasks?.join(",") === "task-a,task-b,task-c" &&
        successData?.overallResult?.failedTasks?.length === 0 &&
        successData?.overallResult?.skippedTasks?.length === 0,
      details: {
        overallResult: successData?.overallResult,
      },
      ...(successScenario.result?.ok === true &&
      successData?.overallResult?.completedTasks?.join(",") === "task-a,task-b,task-c" &&
      successData?.overallResult?.failedTasks?.length === 0 &&
      successData?.overallResult?.skippedTasks?.length === 0
        ? {}
        : { error: "expected all three tasks to complete in topological order" }),
    },
    {
      id: "scenario-a-progress-events",
      passed:
        successScenario.progressEvents.length === 6 &&
        successEvents.join(",") ===
          "task.started:task-a,task.completed:task-a,task.started:task-b,task.completed:task-b,task.started:task-c,task.completed:task-c",
      details: {
        progressEvents: successScenario.progressEvents,
      },
      ...(successScenario.progressEvents.length === 6 &&
      successEvents.join(",") ===
        "task.started:task-a,task.completed:task-a,task.started:task-b,task.completed:task-b,task.started:task-c,task.completed:task-c"
        ? {}
        : { error: "expected started/completed events for each task" }),
    },
    {
      id: "scenario-a-task-artifacts",
      passed: successTaskDirs.length === 3,
      details: {
        runDir: successScenario.runDir,
        taskDirs: successTaskDirs,
      },
      ...(successTaskDirs.length === 3 ? {} : { error: "expected artifact directories for all tasks" }),
    },
    {
      id: "scenario-b-failure-propagation",
      passed:
        failureScenario.result?.ok === false &&
        failureData?.overallResult?.failedTasks?.includes("task-a") === true &&
        failureData?.overallResult?.completedTasks?.includes("task-b") === true &&
        failureData?.overallResult?.skippedTasks?.includes("task-c") === true &&
        taskCResult?.status === "skipped" &&
        typeof taskCResult?.skippedReason === "string" &&
        taskCResult.skippedReason.includes("task-a"),
      details: {
        overallResult: failureData?.overallResult,
        taskCResult,
      },
      ...(failureScenario.result?.ok === false &&
      failureData?.overallResult?.failedTasks?.includes("task-a") === true &&
      failureData?.overallResult?.completedTasks?.includes("task-b") === true &&
      failureData?.overallResult?.skippedTasks?.includes("task-c") === true &&
      taskCResult?.status === "skipped" &&
      typeof taskCResult?.skippedReason === "string" &&
      taskCResult.skippedReason.includes("task-a")
        ? {}
        : { error: "expected task-a failure to skip task-c while task-b still completes" }),
    },
    {
      id: "scenario-b-progress-events",
      passed:
        failureEvents.includes("task.failed:task-a") &&
        failureEvents.includes("task.completed:task-b") &&
        failureEvents.includes("task.skipped:task-c") &&
        !failureEvents.includes("task.started:task-c"),
      details: {
        progressEvents: failureScenario.progressEvents,
      },
      ...(failureEvents.includes("task.failed:task-a") &&
      failureEvents.includes("task.completed:task-b") &&
      failureEvents.includes("task.skipped:task-c") &&
      !failureEvents.includes("task.started:task-c")
        ? {}
        : { error: "expected failed, completed, and skipped events with no task-c start" }),
    },
    {
      id: "scenario-c-task-cap",
      passed:
        oversizedResult?.ok === false &&
        Array.isArray(oversizedResult?.errors) &&
        String(oversizedResult.errors[0]?.message ?? "").includes("max of 15"),
      details: {
        errors: oversizedResult?.errors,
      },
      ...(oversizedResult?.ok === false &&
      Array.isArray(oversizedResult?.errors) &&
      String(oversizedResult.errors[0]?.message ?? "").includes("max of 15")
        ? {}
        : { error: "expected an explicit max-15 task cap failure" }),
    },
  ];

  const passedCount = results.filter((entry) => entry.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(evalRoot, ".reports");
  ensureDir(reportsDir);
  writeFileSync(resolve(reportsDir, "eval_orchestrator_multi.latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  rmSync(successScenario.tempRepo, { recursive: true, force: true });
  rmSync(failureScenario.tempRepo, { recursive: true, force: true });

  console.log(JSON.stringify({ event: "eval_orchestrator_multi.done", ok: report.passRate === 1, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ event: "eval_orchestrator_multi.done", ok: false, passRate: 0, error: (error as Error).message }));
  process.exit(1);
});
