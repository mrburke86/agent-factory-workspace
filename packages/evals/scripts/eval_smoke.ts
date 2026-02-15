import fs from "node:fs";
import path from "node:path";
import { runSuites, assertPassRate } from "../src/runner/run.js";
import { runSmokeSuite } from "../src/suites/smoke.js";
import { logInfo, logError } from "../src/runner/logger.js";

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function main() {
  logInfo("eval_smoke.start", {
    node: process.version,
    cwd: process.cwd()
  });

  const report = await runSuites([runSmokeSuite]);
  assertPassRate(report, 1.0);

  const reportsDir = path.resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = path.join(reportsDir, "eval_smoke.latest.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  logInfo("eval_smoke.ok", {
    outPath,
    overallPassRate: report.overallPassRate,
    suites: report.suites.map(s => ({ suiteName: s.suiteName, passRate: s.passRate, count: s.results.length }))
  });

  // Keep the existing human-readable output
  console.log("✅ eval smoke passed");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  logError("eval_smoke.fail", {
    message: err?.message || String(err),
    stack: err?.stack
  });
  console.error(err?.stack || String(err));
  process.exit(1);
});
