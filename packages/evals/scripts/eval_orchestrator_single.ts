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

async function main(): Promise<void> {
  const suiteName = "eval_orchestrator_single";
  const evalRoot = process.cwd();
  const repoRoot = resolve(evalRoot, "..", "..");
  const fixturesRoot = resolve(evalRoot, "fixtures", "orchestrator");
  const run = await loadOrchestratorRun(repoRoot);

  const task = loadFixture(join(fixturesRoot, "task.json"));
  const l2Config = loadFixture(join(fixturesRoot, "l2-config.json"));
  const stageNames = ["context-gather", "plan", "repo-patch", "validate", "git-pr"] as const;
  const stageRunners = Object.fromEntries(
    stageNames.map((stageName) => [
      stageName,
      async () => loadFixture(join(fixturesRoot, "mock-stage-outputs", `${stageName}.json`)),
    ]),
  );

  const tempRepo = mkdtempSync(join(tmpdir(), "af-orchestrator-single-"));
  mkdirSync(join(tempRepo, "src"), { recursive: true });
  writeFileSync(join(tempRepo, "src", "health.ts"), "export function health() { return 'ok'; }\n", "utf8");

  let result: any;
  try {
    result = await run({
      task,
      l2Config,
      repoRoot: tempRepo,
      _stageRunners: stageRunners,
    });
  } finally {
    // Keep the temp repo until assertions finish; cleanup is handled below.
  }

  const data = result?.data;
  const runDir = data?.correlationId
    ? join(tempRepo, ".factory", "runs", data.correlationId)
    : "";
  const expectedArtifacts = [
    "task.json",
    "plan.json",
    "result.json",
    "context-gather.json",
    "repo-patch.json",
    "validate.json",
    "git-pr.json",
  ];
  const missingArtifacts = expectedArtifacts.filter((fileName) => !existsSync(join(runDir, fileName)));

  const results: CheckResult[] = [
    {
      id: "agent-run-ok",
      passed: result?.ok === true,
      ...(result?.ok === true ? {} : { error: "orchestrator did not return ok: true" }),
    },
    {
      id: "completed-all-stages",
      passed: Array.isArray(data?.pipelineResult?.completedStages) && data.pipelineResult.completedStages.length === 5,
      details: {
        completedStages: data?.pipelineResult?.completedStages,
      },
      ...(Array.isArray(data?.pipelineResult?.completedStages) && data.pipelineResult.completedStages.length === 5
        ? {}
        : { error: "expected 5 completed stages" }),
    },
    {
      id: "stage-results-length",
      passed: Array.isArray(data?.stageResults) && data.stageResults.length === 5,
      details: {
        stageResults: data?.stageResults?.length,
      },
      ...(Array.isArray(data?.stageResults) && data.stageResults.length === 5
        ? {}
        : { error: "expected 5 stageResults entries" }),
    },
    {
      id: "token-usage-populated",
      passed: typeof data?.tokenUsage?.total === "number" && data.tokenUsage.total >= 0,
      details: {
        tokenUsage: data?.tokenUsage,
      },
      ...(typeof data?.tokenUsage?.total === "number" && data.tokenUsage.total >= 0
        ? {}
        : { error: "tokenUsage.total missing or invalid" }),
    },
    {
      id: "artifacts-written",
      passed: runDir.length > 0 && missingArtifacts.length === 0,
      details: {
        runDir,
        missingArtifacts,
      },
      ...(runDir.length > 0 && missingArtifacts.length === 0
        ? {}
        : { error: `missing artifacts: ${missingArtifacts.join(", ")}` }),
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
  writeFileSync(resolve(reportsDir, "eval_orchestrator_single.latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  rmSync(tempRepo, { recursive: true, force: true });

  console.log(JSON.stringify({ event: "eval_orchestrator_single.done", ok: report.passRate === 1, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ event: "eval_orchestrator_single.done", ok: false, passRate: 0, error: (error as Error).message }));
  process.exit(1);
});
