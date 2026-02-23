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

type RankedFile = {
  path: string;
  relevanceScore: number;
  summary: string;
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

function isSortedDescending(files: RankedFile[]): boolean {
  for (let i = 1; i < files.length; i += 1) {
    if (files[i - 1].relevanceScore < files[i].relevanceScore) return false;
  }
  return true;
}

function hasForbiddenPath(files: RankedFile[]): string[] {
  const forbiddenSegments = ["/node_modules/", "/dist/", "/.factory/", "/.git/"];
  return files
    .map((file) => file.path.replaceAll("\\", "/"))
    .filter((pathValue) => forbiddenSegments.some((segment) => pathValue.includes(segment) || pathValue.startsWith(segment.slice(1))));
}

async function main(): Promise<void> {
  const suiteName = "eval_context_gather";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fail(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const input = JSON.stringify({
    repoRoot: "packages/evals/fixtures/context-gather/repo",
    taskDescription: "add health endpoint",
  });
  const completed = spawnSync(
    process.execPath,
    [cliPath, "agent:run", "context-gather", "--input", input, "--validate-input"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (completed.error) {
    fail(completed.error.message);
  }

  let parsed: any;
  try {
    parsed = parseStdoutJson(completed.stdout ?? "");
  } catch (error) {
    fail(`unable to parse CLI JSON output: ${(error as Error).message}`);
  }

  const files = Array.isArray(parsed?.result?.data?.files) ? (parsed.result.data.files as RankedFile[]) : [];
  const topFive = files.slice(0, 5).map((file) => file.path);
  const expectedRelevant = [
    "src/server.ts",
    "src/routes/index.ts",
    "src/routes/health.ts",
    "src/controllers/health-controller.ts",
    "src/services/health-service.ts",
  ];
  const topFiveHits = expectedRelevant.filter((pathValue) => topFive.includes(pathValue)).length;
  const forbidden = hasForbiddenPath(files);

  const results: CheckResult[] = [
    {
      id: "agent-run-ok",
      passed: completed.status === 0 && parsed?.ok === true && parsed?.result?.ok === true,
      details: {
        exitCode: completed.status,
      },
      ...(completed.status === 0 && parsed?.ok === true && parsed?.result?.ok === true
        ? {}
        : { error: (completed.stderr || "context-gather run failed").trim() || "context-gather run failed" }),
    },
    {
      id: "output-has-files-array",
      passed: Array.isArray(files) && files.length > 0,
      details: {
        filesCount: files.length,
      },
      ...(Array.isArray(files) && files.length > 0 ? {} : { error: "files[] missing or empty" }),
    },
    {
      id: "sorted-by-relevance",
      passed: isSortedDescending(files),
      details: {
        topFive,
      },
      ...(isSortedDescending(files) ? {} : { error: "files[] is not sorted by relevanceScore descending" }),
    },
    {
      id: "skip-forbidden-dirs",
      passed: forbidden.length === 0,
      details: {
        forbidden,
      },
      ...(forbidden.length === 0 ? {} : { error: `found forbidden paths: ${forbidden.join(", ")}` }),
    },
    {
      id: "top-five-accuracy",
      passed: topFiveHits >= 4,
      details: {
        expectedRelevant,
        topFive,
        topFiveHits,
      },
      ...(topFiveHits >= 4 ? {} : { error: `expected >= 4 relevant files in top 5, got ${topFiveHits}` }),
    },
  ];

  const passedCount = results.filter((result) => result.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = resolve(reportsDir, "eval_context_gather.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_context_gather.done", outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fail((error as Error).message));
