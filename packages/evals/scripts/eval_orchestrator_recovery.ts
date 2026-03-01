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
  const suiteName = "eval_orchestrator_recovery";
  const evalRoot = process.cwd();
  const repoRoot = resolve(evalRoot, "..", "..");
  const fixturesRoot = resolve(evalRoot, "fixtures", "orchestrator");
  const run = await loadOrchestratorRun(repoRoot);
  const task = loadFixture(join(fixturesRoot, "task.json"));
  const l2Config = loadFixture(join(fixturesRoot, "l2-config.json"));
  const attemptCounts: number[] = [];

  const tempRepo = mkdtempSync(join(tmpdir(), "af-orchestrator-recovery-"));
  mkdirSync(join(tempRepo, "src"), { recursive: true });
  writeFileSync(join(tempRepo, "src", "health.ts"), "export function health() { return 'ok'; }\n", "utf8");

  const result = await run({
    task,
    l2Config,
    repoRoot: tempRepo,
    _stageRunners: {
      "context-gather": async () => loadFixture(join(fixturesRoot, "mock-stage-outputs", "context-gather.json")),
      plan: async () => {
        throw new Error("validation gate failed");
      },
      "error-recover": async (input: any) => {
        attemptCounts.push(input.attemptCount);
        const capped = input.attemptCount >= 3;
        return {
          diagnosis: capped ? "plan failed with MAX_RETRIES" : "plan failed with VALIDATION_FAILURE",
          errorClass: capped ? "MAX_RETRIES" : "VALIDATION_FAILURE",
          recoveryAction: capped ? "escalate" : "retry_modified",
          shouldRetry: !capped,
          escalate: capped,
          rationale: capped ? "Retry caps are enforced globally, so this failure must escalate." : "The failure is recoverable with a targeted retry using adjusted input.",
        };
      },
    },
  });

  const data = result?.data;
  const runDir = data?.correlationId
    ? join(tempRepo, ".factory", "runs", data.correlationId)
    : "";
  const recoveryArtifacts = runDir.length > 0
    ? ["error-recover-plan-1.json", "error-recover-plan-2.json", "error-recover-plan-3.json"].filter(
        (fileName) => existsSync(join(runDir, fileName)),
      )
    : [];

  const results: CheckResult[] = [
    {
      id: "agent-run-failed",
      passed: result?.ok === false,
      ...(result?.ok === false ? {} : { error: "expected orchestrator to return ok: false" }),
    },
    {
      id: "failed-stage-plan",
      passed: data?.pipelineResult?.failedStage === "plan",
      details: {
        failedStage: data?.pipelineResult?.failedStage,
      },
      ...(data?.pipelineResult?.failedStage === "plan" ? {} : { error: "expected failedStage to be plan" }),
    },
    {
      id: "error-recover-consulted",
      passed: attemptCounts.length === 3,
      details: {
        attemptCounts,
      },
      ...(attemptCounts.length === 3 ? {} : { error: `expected 3 error-recover consultations, got ${attemptCounts.length}` }),
    },
    {
      id: "retry-cap-enforced",
      passed: Array.isArray(attemptCounts) && attemptCounts.join(",") === "1,2,3",
      details: {
        attemptCounts,
      },
      ...(Array.isArray(attemptCounts) && attemptCounts.join(",") === "1,2,3"
        ? {}
        : { error: "expected attemptCount progression 1,2,3" }),
    },
    {
      id: "recovery-artifacts-written",
      passed: recoveryArtifacts.length === 3,
      details: {
        recoveryArtifacts,
      },
      ...(recoveryArtifacts.length === 3 ? {} : { error: "expected 3 recovery artifact files" }),
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
  writeFileSync(resolve(reportsDir, "eval_orchestrator_recovery.latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  rmSync(tempRepo, { recursive: true, force: true });

  console.log(JSON.stringify({ event: "eval_orchestrator_recovery.done", ok: report.passRate === 1, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ event: "eval_orchestrator_recovery.done", ok: false, passRate: 0, error: (error as Error).message }));
  process.exit(1);
});
