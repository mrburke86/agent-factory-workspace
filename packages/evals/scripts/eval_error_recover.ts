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

type ExpectedResult = {
  errorClass: string;
  recoveryAction: string;
  shouldRetry: boolean;
  escalate: boolean;
};

const EXPECTATIONS: Record<string, ExpectedResult> = {
  "build-error.json": {
    errorClass: "BUILD_ERROR",
    recoveryAction: "retry_modified",
    shouldRetry: true,
    escalate: false,
  },
  "test-failure.json": {
    errorClass: "TEST_FAILURE",
    recoveryAction: "retry_modified",
    shouldRetry: true,
    escalate: false,
  },
  "patch-failure.json": {
    errorClass: "PATCH_FAILURE",
    recoveryAction: "rollback",
    shouldRetry: false,
    escalate: false,
  },
  "budget-exceeded.json": {
    errorClass: "BUDGET_EXCEEDED",
    recoveryAction: "escalate",
    shouldRetry: false,
    escalate: true,
  },
  "max-retries-hit.json": {
    errorClass: "MAX_RETRIES",
    recoveryAction: "escalate",
    shouldRetry: false,
    escalate: true,
  },
};

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function loadFixture(pathValue: string): unknown {
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
  console.log(JSON.stringify({ event: "eval_error_recover.done", ok: false, error: message }));
  process.exit(1);
}

function runFixture(cliPath: string, repoRoot: string, fixtureName: string): { exitCode: number | null; parsed: any; stderr: string } {
  const fixturePath = resolve(process.cwd(), "fixtures", "error-recover", fixtureName);
  const completed = spawnSync(
    process.execPath,
    [cliPath, "agent:run", "error-recover", "--input", JSON.stringify(loadFixture(fixturePath)), "--validate-input"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

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
    fatal(`unable to parse CLI JSON output for ${fixtureName}: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const suiteName = "eval_error_recover";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fatal(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const results: CheckResult[] = Object.entries(EXPECTATIONS).map(([fixtureName, expected]) => {
    const run = runFixture(cliPath, repoRoot, fixtureName);
    const data = run.parsed?.result?.data;
    const passed =
      run.exitCode === 0 &&
      run.parsed?.ok === true &&
      run.parsed?.result?.ok === true &&
      data?.errorClass === expected.errorClass &&
      data?.recoveryAction === expected.recoveryAction &&
      data?.shouldRetry === expected.shouldRetry &&
      data?.escalate === expected.escalate;

    return {
      id: fixtureName.replace(".json", ""),
      passed,
      details: {
        exitCode: run.exitCode,
        expected,
        actual: {
          errorClass: data?.errorClass,
          recoveryAction: data?.recoveryAction,
          shouldRetry: data?.shouldRetry,
          escalate: data?.escalate,
        },
      },
      ...(passed ? {} : { error: run.stderr || `unexpected result for ${fixtureName}` }),
    };
  });

  const passedCount = results.filter((result) => result.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);
  const outPath = resolve(reportsDir, "eval_error_recover.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_error_recover.done", ok: report.passRate === 1, outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fatal((error as Error).message));
