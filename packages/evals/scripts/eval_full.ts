import { runSuites, assertPassRate } from "../src/runner/run.js";
import { runSmokeSuite } from "../src/suites/smoke.js";

async function main() {
  const report = await runSuites([
    runSmokeSuite
    // Add full suites later (retrieval, extraction, entity resolution, etc.)
  ]);

  // Relaxed default for "full" once you add non-smoke suites.
  assertPassRate(report, 0.95);

  console.log("✅ eval full passed");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
