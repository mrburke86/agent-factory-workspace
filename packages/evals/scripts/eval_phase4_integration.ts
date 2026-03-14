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

const EXPECTED_CLASSIFICATIONS = [
  "scaffold",
  "schema_gen",
  "route_gen",
  "component_gen",
  "auth_config",
  "payment_config",
] as const;

const EXPECTED_AGENTS = [
  "project-scaffold",
  "db-schema",
  "api-gen",
  "ui-gen",
  "auth-scaffold",
  "payments-gen",
] as const;

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function parseStdoutJson(stdout: string): any {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    throw new Error("no JSON output from CLI");
  }
  return JSON.parse(lastLine);
}

async function loadContracts(repoRoot: string): Promise<any> {
  const entryPath = resolve(repoRoot, "packages", "contracts", "dist", "src", "index.js");
  if (!existsSync(entryPath)) {
    throw new Error(`missing built contracts entry: ${entryPath}. Did you run: pnpm -r build ?`);
  }
  return import(pathToFileURL(entryPath).href);
}

async function main(): Promise<void> {
  const suiteName = "eval_phase4_integration";
  const evalRoot = process.cwd();
  const repoRoot = resolve(evalRoot, "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  const contracts = await loadContracts(repoRoot);

  const completed = spawnSync(
    process.execPath,
    [
      cliPath,
      "pipeline:run",
      "--brief",
      "Next.js micro-SaaS with auth and payments",
      "--l2-config",
      "docs/examples/nextjs-micro-saas.json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (completed.error) {
    throw completed.error;
  }

  const parsed = parseStdoutJson(completed.stdout ?? "");
  const planTasks = Array.isArray(parsed?.plan?.tasks) ? parsed.plan.tasks : [];
  const taskClassifications = planTasks.map((task: any) => task?.classification).filter((value: unknown) => typeof value === "string");
  const executedAgents = Array.isArray(parsed?.generationSummary?.executedAgents) ? parsed.generationSummary.executedAgents : [];
  const decisionLog = Array.isArray(parsed?.generationSummary?.decisionLog) ? parsed.generationSummary.decisionLog : [];
  const materializedFiles = Array.isArray(parsed?.generationSummary?.materializedFiles) ? parsed.generationSummary.materializedFiles : [];
  const generatedProjectDir = typeof parsed?.generatedProjectDir === "string" ? parsed.generatedProjectDir : "";
  const taskResults = Array.isArray(parsed?.pipeline?.taskResults) ? parsed.pipeline.taskResults : [];
  const finalTaskResult = taskResults[taskResults.length - 1];
  const validateArtifactPath =
    finalTaskResult && typeof finalTaskResult.artifactPath === "string"
      ? resolve(finalTaskResult.artifactPath, "validate.json")
      : "";
  const validateArtifact = validateArtifactPath && existsSync(validateArtifactPath)
    ? JSON.parse(readFileSync(validateArtifactPath, "utf8"))
    : null;
  const validateResults = Array.isArray(validateArtifact?.results) ? validateArtifact.results : [];

  const classificationErrors = taskClassifications.flatMap((classification: unknown) => {
    try {
      contracts.TaskClassificationSchema.parse(classification);
      return [];
    } catch (error) {
      return [(error as Error).message];
    }
  });

  const requiredFiles = [
    "src/app/api/health/route.ts",
    "src/db/drizzle/schema.ts",
    "src/components/WorkspaceOverviewCard.tsx",
    "src/auth/auth.ts",
    "src/app/api/stripe/webhook/route.ts",
  ];

  const results: CheckResult[] = [
    {
      id: "pipeline-run-completes",
      passed: completed.status === 0 && parsed?.ok === true && parsed?.status === "COMPLETED",
      details: { exitCode: completed.status, status: parsed?.status },
      ...(completed.status === 0 && parsed?.ok === true && parsed?.status === "COMPLETED"
        ? {}
        : { error: completed.stderr || "expected Phase 4 pipeline run to complete successfully" }),
    },
    {
      id: "task-classifications-complete",
      passed:
        classificationErrors.length === 0 &&
        JSON.stringify(taskClassifications) === JSON.stringify(EXPECTED_CLASSIFICATIONS),
      details: { taskClassifications },
      ...(classificationErrors.length === 0 &&
      JSON.stringify(taskClassifications) === JSON.stringify(EXPECTED_CLASSIFICATIONS)
        ? {}
        : { error: classificationErrors.join("; ") || "unexpected generation task classification order" }),
    },
    {
      id: "generation-agents-run-in-order",
      passed: JSON.stringify(executedAgents) === JSON.stringify(EXPECTED_AGENTS),
      details: { executedAgents },
      ...(JSON.stringify(executedAgents) === JSON.stringify(EXPECTED_AGENTS)
        ? {}
        : { error: "generation agent order did not match the fixed Phase 4 chain" }),
    },
    {
      id: "generated-project-written",
      passed: generatedProjectDir.length > 0 && existsSync(generatedProjectDir),
      details: { generatedProjectDir },
      ...(generatedProjectDir.length > 0 && existsSync(generatedProjectDir)
        ? {}
        : { error: "generated project directory missing from pipeline output" }),
    },
    {
      id: "required-generated-files-present",
      passed: requiredFiles.every((relativePath) => materializedFiles.includes(relativePath)),
      details: { materializedFiles },
      ...(requiredFiles.every((relativePath) => materializedFiles.includes(relativePath))
        ? {}
        : { error: "missing required generated file in materialized output" }),
    },
    {
      id: "decision-log-present",
      passed:
        decisionLog.some((entry: any) => entry?.key === "auth-strategy") &&
        decisionLog.some((entry: any) => entry?.key === "payment-model-architecture"),
      details: { decisionLogCount: decisionLog.length },
      ...(decisionLog.some((entry: any) => entry?.key === "auth-strategy") &&
      decisionLog.some((entry: any) => entry?.key === "payment-model-architecture")
        ? {}
        : { error: "expected auth and payments decision-log entries in generation summary" }),
    },
    {
      id: "tsc-validation-passed",
      passed: validateResults.some((result: any) => typeof result?.command === "string" && result.command.includes("tsc --noEmit") && result.exitCode === 0),
      details: { validateResults },
      ...(validateResults.some((result: any) => typeof result?.command === "string" && result.command.includes("tsc --noEmit") && result.exitCode === 0)
        ? {}
        : { error: "missing successful generated-project tsc validation result" }),
    },
    {
      id: "next-equivalent-validation-passed",
      passed: validateResults.some((result: any) => result?.command === "next build equivalent" && result.exitCode === 0),
      details: { validateResults },
      ...(validateResults.some((result: any) => result?.command === "next build equivalent" && result.exitCode === 0)
        ? {}
        : { error: "missing successful next build equivalent validation result" }),
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
  const outPath = resolve(reportsDir, "eval_phase4_integration.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_phase4_integration.done", ok: report.passRate === 1, outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ event: "eval_phase4_integration.done", ok: false, error: (error as Error).message }));
  process.exit(1);
});
