// packages/evals/scripts/agent_runner_smoke.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Report = {
  suiteName: string;
  passRate: number;
  count: number;
  results: Array<{
    id: string;
    passed: boolean;
    details?: unknown;
    error?: string;
  }>;
};

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function parseStdoutJson(stdout: string): any {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    throw new Error("no stdout output from CLI");
  }
  return JSON.parse(lastLine);
}

async function main() {
  const suiteName = "agent_runner_smoke";
  const cliPath = resolve(
    process.cwd(),
    "..",
    "..",
    "packages",
    "factory",
    "dist",
    "cli.js",
  );
  if (!existsSync(cliPath)) {
    fail(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const input = JSON.stringify({ query: "refund policy", topK: 5 });
  const cp = spawnSync(
    process.execPath,
    [cliPath, "agent:run", "retrieval-smoke", "--input", input],
    {
      encoding: "utf8",
      cwd: process.cwd(),
    },
  );

  if (cp.error) {
    fail(cp.error.message);
  }

  let parsed: any;
  try {
    parsed = parseStdoutJson(cp.stdout ?? "");
  } catch (e) {
    fail(`failed to parse CLI JSON output: ${(e as Error).message}`);
  }

  const topDoc = parsed?.result?.data?.hits?.[0]?.docId;
  const passed = parsed?.ok === true && topDoc === "doc_refund_policy";

  const results: Report["results"] = [
    {
      id: "retrieval-smoke-cli",
      passed,
      details: {
        exitCode: cp.status,
        requiredDocId: "doc_refund_policy",
        gotTopDocId: topDoc ?? null,
      },
      ...(passed
        ? {}
        : {
            error:
              (cp.stderr || "unexpected CLI result").trim() ||
              "unexpected CLI result",
          }),
    },
  ];

  const passedCount = results.filter((r) => r.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = resolve(reportsDir, "agent_runner_smoke.latest.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify({
      event: "agent_runner_smoke.done",
      outPath,
      passRate: report.passRate,
    }),
  );

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((e) => fail((e as Error)?.message ?? String(e)));
