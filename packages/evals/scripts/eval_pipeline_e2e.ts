import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

function fatal(message: string): never {
  console.log(JSON.stringify({ event: "eval_pipeline_e2e.done", ok: false, error: message }));
  process.exit(1);
}

function runPipeline(cliPath: string, repoRoot: string, args: string[]): { exitCode: number | null; parsed: any; stderr: string } {
  const completed = spawnSync(process.execPath, [cliPath, "pipeline:run", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (completed.error) {
    fatal(completed.error.message);
  }

  try {
    return {
      exitCode: completed.status,
      parsed: parseStdoutJson(completed.stdout ?? ""),
      stderr: (completed.stderr ?? "").trim(),
    };
  } catch (error) {
    fatal(`unable to parse CLI JSON output: ${(error as Error).message}`);
  }
}

function isTopologicallyOrdered(tasks: any[]): boolean {
  const positions = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (typeof task?.id === "string") {
      positions.set(task.id, index);
    }
  });

  return tasks.every((task, index) => {
    const dependsOn = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
    return dependsOn.every((dependencyId: unknown) => {
      if (typeof dependencyId !== "string") return false;
      const dependencyIndex = positions.get(dependencyId);
      return dependencyIndex !== undefined && dependencyIndex < index;
    });
  });
}

async function main(): Promise<void> {
  const suiteName = "eval_pipeline_e2e";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fatal(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const fixture = loadFixture(resolve(process.cwd(), "fixtures", "pipeline-e2e", "input.json"));
  const ambiguousFixture = loadFixture(resolve(process.cwd(), "fixtures", "brief-intake", "ambiguous-brief.json"));

  const successRun = runPipeline(cliPath, repoRoot, ["--brief", fixture.brief, "--l2-config", fixture.l2ConfigPath]);
  const pauseRun = runPipeline(cliPath, repoRoot, ["--brief", ambiguousFixture.brief, "--l2-config", fixture.l2ConfigPath]);
  const resumeRun = runPipeline(cliPath, repoRoot, [
    "--brief",
    ambiguousFixture.brief,
    "--l2-config",
    fixture.l2ConfigPath,
    "--answers",
    JSON.stringify({
      "security-auth-strategy": "Use Auth.js email sign-in.",
      "architecture-data-store": "Use PostgreSQL for persisted data.",
      "architecture-deployment-target": "Deploy to Vercel.",
    }),
  ]);

  const successTasks = Array.isArray(successRun.parsed?.plan?.tasks) ? successRun.parsed.plan.tasks : [];
  const firstTaskResult = Array.isArray(successRun.parsed?.pipeline?.taskResults)
    ? successRun.parsed.pipeline.taskResults[0]
    : undefined;
  const firstTaskStages = Array.isArray(firstTaskResult?.stageResults) ? firstTaskResult.stageResults : [];
  const pauseQuestions = Array.isArray(pauseRun.parsed?.questions) ? pauseRun.parsed.questions : [];

  const results: CheckResult[] = [
    {
      id: "success-run-completes",
      passed: successRun.exitCode === 0 && successRun.parsed?.ok === true && successRun.parsed?.status === "COMPLETED",
      details: { exitCode: successRun.exitCode, status: successRun.parsed?.status },
      ...(successRun.exitCode === 0 && successRun.parsed?.ok === true && successRun.parsed?.status === "COMPLETED"
        ? {}
        : { error: successRun.stderr || "expected pipeline run to complete successfully" }),
    },
    {
      id: "success-plan-is-ordered",
      passed:
        successTasks.length >= 3 &&
        successTasks.every((task: any) => typeof task?.id === "string" && Array.isArray(task?.dependsOn)) &&
        isTopologicallyOrdered(successTasks),
      details: { taskCount: successTasks.length, tasks: successTasks },
      ...(successTasks.length >= 3 &&
      successTasks.every((task: any) => typeof task?.id === "string" && Array.isArray(task?.dependsOn)) &&
      isTopologicallyOrdered(successTasks)
        ? {}
        : { error: "expected a dependency-ordered task list" }),
    },
    {
      id: "success-plan-stage-ran",
      passed: firstTaskStages.some((stage: any) => stage?.stageName === "plan" && stage?.ok === true),
      details: { firstTaskStages },
      ...(firstTaskStages.some((stage: any) => stage?.stageName === "plan" && stage?.ok === true)
        ? {}
        : { error: "expected the first task to complete the plan stage" }),
    },
    {
      id: "clarification-pauses",
      passed: pauseRun.exitCode === 0 && pauseRun.parsed?.status === "AWAITING_CLARIFICATION" && pauseQuestions.length >= 1,
      details: { exitCode: pauseRun.exitCode, status: pauseRun.parsed?.status, questionCount: pauseQuestions.length },
      ...(pauseRun.exitCode === 0 && pauseRun.parsed?.status === "AWAITING_CLARIFICATION" && pauseQuestions.length >= 1
        ? {}
        : { error: pauseRun.stderr || "expected ambiguous brief to pause for clarification" }),
    },
    {
      id: "clarification-resumes",
      passed: resumeRun.exitCode === 0 && resumeRun.parsed?.ok === true && resumeRun.parsed?.status === "COMPLETED",
      details: { exitCode: resumeRun.exitCode, status: resumeRun.parsed?.status },
      ...(resumeRun.exitCode === 0 && resumeRun.parsed?.ok === true && resumeRun.parsed?.status === "COMPLETED"
        ? {}
        : { error: resumeRun.stderr || "expected answers to resume the pipeline" }),
    },
  ];

  const passedCount = results.filter((entry) => entry.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);
  const outPath = resolve(reportsDir, "eval_pipeline_e2e.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_pipeline_e2e.done", ok: report.passRate === 1, outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fatal((error as Error).message));
