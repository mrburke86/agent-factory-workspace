import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logInfo, logWarn, logError } from "./logger.js";

type Snapshot = {
  version: string;
  exports: Record<string, { type: "schema" | "type" | "openapi"; signature: string }>;
};

function die(msg: string): never {
  logError("contracts.breaking_check.die", { msg });
  console.error(msg);
  process.exit(1);
}

function loadSnapshot(p: string): Snapshot {
  if (!fs.existsSync(p)) die(`Missing snapshot: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Snapshot;
}

/**
 * v1 snapshot strategy:
 * - Compare baseline snapshot vs current snapshot.
 * - Fail if an existing export key disappears OR its signature changes.
 */
export function runBreakingCheck() {
  const root = process.cwd();
  const baselinePath = path.resolve(root, "compat_snapshot.json");
  const currentPath = path.resolve(root, "compat_snapshot.current.json");

  logInfo("contracts.breaking_check.start", {
    cwd: root,
    baselinePath,
    currentPath,
    exists: {
      baseline: fs.existsSync(baselinePath),
      current: fs.existsSync(currentPath)
    }
  });

  const baseline = loadSnapshot(baselinePath);
  const current = loadSnapshot(currentPath);

  const baselineKeys = Object.keys(baseline.exports || {});
  const currentKeys = Object.keys(current.exports || {});

  logInfo("contracts.breaking_check.loaded", {
    baselineVersion: baseline.version,
    currentVersion: current.version,
    baselineExports: baselineKeys.length,
    currentExports: currentKeys.length
  });

  const errors: string[] = [];

  for (const [k, v] of Object.entries(baseline.exports)) {
    const now = current.exports[k];
    if (!now) errors.push(`BREAKING: export removed: ${k}`);
    else if (now.signature !== v.signature) errors.push(`BREAKING: signature changed: ${k}`);
  }

  if (errors.length) {
    logWarn("contracts.breaking_check.failed", {
      breakingCount: errors.length,
      breaking: errors
    });
    console.error(errors.join("\n"));
    process.exit(2);
  }

  logInfo("contracts.breaking_check.ok", { compared: baselineKeys.length });
  console.log("✅ contracts breaking-check passed");
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  runBreakingCheck();
}
