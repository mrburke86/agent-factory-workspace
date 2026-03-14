import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

function runNodeScript(scriptPath: string, cwd: string): { exitCode: number | null; stdout: string; stderr: string } {
  const completed = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
  });

  return {
    exitCode: completed.status,
    stdout: completed.stdout ?? "",
    stderr: completed.error ? completed.error.message : (completed.stderr ?? ""),
  };
}

async function loadContracts(repoRoot: string): Promise<any> {
  const entryPath = resolve(repoRoot, "packages", "contracts", "dist", "src", "index.js");
  if (!existsSync(entryPath)) {
    throw new Error(`missing built contracts entry: ${entryPath}. Did you run: pnpm -r build ?`);
  }
  return import(pathToFileURL(entryPath).href);
}

async function main(): Promise<void> {
  const suiteName = "eval_golden_fixtures";
  const evalRoot = process.cwd();
  const repoRoot = resolve(evalRoot, "..", "..");
  const fixturePath = resolve(evalRoot, "fixtures", "golden", "phase4-generation.fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const contracts = await loadContracts(repoRoot);

  const regressionScripts = [
    "eval_l2_config_validate.js",
    "eval_context_gather.js",
    "eval_task_decompose.js",
    "eval_brief_intake.js",
    "eval_error_recover.js",
    "eval_orchestrator_single.js",
    "eval_orchestrator_recovery.js",
    "eval_orchestrator_multi.js",
    "eval_pipeline_e2e.js",
  ];

  const results: CheckResult[] = regressionScripts.map((scriptName) => {
    const scriptPath = resolve(evalRoot, "dist", "scripts", scriptName);
    const completed = runNodeScript(scriptPath, evalRoot);
    const passed = completed.exitCode === 0;
    return {
      id: `regression-${scriptName.replace(/\.js$/, "")}`,
      passed,
      details: {
        exitCode: completed.exitCode,
      },
      ...(passed ? {} : { error: completed.stderr || completed.stdout || "golden fixture regression failed" }),
    };
  });

  const classificationChecks = Array.isArray(fixture.taskClassifications) ? fixture.taskClassifications : [];
  const decisionLogChecks = Array.isArray(fixture.decisionLogEntries) ? fixture.decisionLogEntries : [];

  const classificationErrors = classificationChecks.flatMap((classification: unknown) => {
    try {
      contracts.TaskClassificationSchema.parse(classification);
      return [];
    } catch (error) {
      return [(error as Error).message];
    }
  });

  results.push({
    id: "phase4-task-classifications-parse",
    passed: classificationErrors.length === 0 && classificationChecks.length === 6,
    details: {
      taskClassifications: classificationChecks,
    },
    ...(classificationErrors.length === 0 && classificationChecks.length === 6
      ? {}
      : { error: classificationErrors.join("; ") || "expected 6 Phase 4 task classifications" }),
  });

  const decisionLogErrors = decisionLogChecks.flatMap((entry: unknown) => {
    try {
      contracts.DecisionLogEntrySchema.parse(entry);
      return [];
    } catch (error) {
      return [(error as Error).message];
    }
  });

  results.push({
    id: "phase4-decision-log-samples-parse",
    passed: decisionLogErrors.length === 0 && decisionLogChecks.length >= 2,
    details: {
      decisionLogEntries: decisionLogChecks.length,
    },
    ...(decisionLogErrors.length === 0 && decisionLogChecks.length >= 2
      ? {}
      : { error: decisionLogErrors.join("; ") || "expected at least two decision-log samples" }),
  });

  const passedCount = results.filter((entry) => entry.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(evalRoot, ".reports");
  ensureDir(reportsDir);
  const outPath = resolve(reportsDir, "eval_golden_fixtures.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_golden_fixtures.done", ok: report.passRate === 1, outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ event: "eval_golden_fixtures.done", ok: false, error: (error as Error).message }));
  process.exit(1);
});
