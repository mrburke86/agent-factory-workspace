import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
  const suiteName = "check_agent_manifests";
  const cliPath = resolve(process.cwd(), "..", "..", "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fail(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const cp = spawnSync(process.execPath, [cliPath, "agent:validate:all"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  if (cp.error) {
    fail(cp.error.message);
  }

  let parsed: any;
  try {
    parsed = parseStdoutJson(cp.stdout ?? "");
  } catch (e) {
    fail(`failed to parse CLI JSON output: ${(e as Error).message}`);
  }

  const passed = parsed?.ok === true;
  const count = typeof parsed?.count === "number" ? parsed.count : 0;
  const results: Report["results"] = [
    {
      id: "agent-manifests",
      passed,
      details: {
        exitCode: cp.status,
        failed: Array.isArray(parsed?.failed) ? parsed.failed : [],
      },
      ...(passed ? {} : { error: (cp.stderr || "manifest validation failed").trim() || "manifest validation failed" }),
    },
  ];

  const passedCount = results.filter((r) => r.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = resolve(reportsDir, "check_agent_manifests.latest.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({ event: "check_agent_manifests.done", outPath, ok: passed, count }));

  if (!passed || report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((e) => fail((e as Error)?.message ?? String(e)));
