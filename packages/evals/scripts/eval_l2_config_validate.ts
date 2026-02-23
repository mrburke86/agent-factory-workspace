import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

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

function runValidation(
  cliPath: string,
  configPath: string,
  repoRoot: string,
): { exitCode: number; parsed?: any; stderr: string; error?: string } {
  const input = JSON.stringify({ configPath });
  const completed = spawnSync(process.execPath, [cliPath, "agent:run", "l2-config-validate", "--input", input, "--validate-input"], {
    encoding: "utf8",
    cwd: repoRoot,
  });

  if (completed.error) {
    return {
      exitCode: 1,
      stderr: "",
      error: completed.error.message,
    };
  }

  try {
    return {
      exitCode: typeof completed.status === "number" ? completed.status : 1,
      parsed: parseStdoutJson(completed.stdout ?? ""),
      stderr: (completed.stderr ?? "").trim(),
    };
  } catch (error) {
    return {
      exitCode: typeof completed.status === "number" ? completed.status : 1,
      stderr: (completed.stderr ?? "").trim(),
      error: `parse error: ${(error as Error).message}`,
    };
  }
}

async function main(): Promise<void> {
  const suiteName = "eval_l2_config_validate";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fail(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const validPath = "packages/evals/fixtures/l2-config/valid-config.json";
  const invalidPath = "packages/evals/fixtures/l2-config/invalid-config.json";

  const validRun = runValidation(cliPath, validPath, repoRoot);
  const validPassed =
    validRun.exitCode === 0 &&
    validRun.parsed?.ok === true &&
    validRun.parsed?.result?.data?.ok === true;

  const invalidRun = runValidation(cliPath, invalidPath, repoRoot);
  const invalidPassed =
    invalidRun.exitCode === 0 &&
    invalidRun.parsed?.ok === true &&
    invalidRun.parsed?.result?.data?.ok === false &&
    Array.isArray(invalidRun.parsed?.result?.data?.errors) &&
    invalidRun.parsed.result.data.errors.length > 0;

  const results: CheckResult[] = [
    {
      id: "valid-config",
      passed: validPassed,
      details: {
        exitCode: validRun.exitCode,
        resultOk: validRun.parsed?.result?.data?.ok ?? null,
      },
      ...(validPassed ? {} : { error: validRun.error ?? (validRun.stderr || "valid config assertion failed") }),
    },
    {
      id: "invalid-config",
      passed: invalidPassed,
      details: {
        exitCode: invalidRun.exitCode,
        resultOk: invalidRun.parsed?.result?.data?.ok ?? null,
        errorsCount: Array.isArray(invalidRun.parsed?.result?.data?.errors)
          ? invalidRun.parsed.result.data.errors.length
          : 0,
      },
      ...(invalidPassed ? {} : { error: invalidRun.error ?? (invalidRun.stderr || "invalid config assertion failed") }),
    },
  ];

  const passedCount = results.filter((item) => item.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);
  const outPath = resolve(reportsDir, "eval_l2_config_validate.latest.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({ event: "eval_l2_config_validate.done", outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fail((error as Error).message));
