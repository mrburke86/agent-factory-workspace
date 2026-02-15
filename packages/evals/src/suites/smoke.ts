import fs from "node:fs";
import path from "node:path";
import type { EvalSuiteReport, EvalCase, EvalResult } from "../runner/types.js";
import { suitePassRate } from "../runner/run.js";
import { retrievalSearch } from "../adapters/retrieval_adapter.js";
import { logInfo, logDebug } from "../runner/logger.js";

function readJsonl<T>(p: string): T[] {
  const raw = fs.readFileSync(p, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map(line => JSON.parse(line)) as T[];
}

/**
 * Smoke philosophy:
 * - tiny dataset
 * - deterministic assertions
 * - validates wiring + basic quality floor
 */
export async function runSmokeSuite(): Promise<EvalSuiteReport> {
  const startedAt = new Date().toISOString();

  const datasetDir = path.resolve(process.cwd(), "src/datasets/smoke");
  const queriesPath = path.join(datasetDir, "queries.jsonl");
  const expectedPath = path.join(datasetDir, "expected.jsonl");

  logInfo("smoke.load_dataset", {
    datasetDir,
    queriesPath,
    expectedPath,
    exists: {
      datasetDir: fs.existsSync(datasetDir),
      queriesPath: fs.existsSync(queriesPath),
      expectedPath: fs.existsSync(expectedPath)
    }
  });

  const queries = readJsonl<EvalCase>(queriesPath);
  const expected = readJsonl<any>(expectedPath);
  const expectedById = new Map(expected.map((e: any) => [e.id, e]));

  logInfo("smoke.dataset_loaded", {
    queries: queries.length,
    expected: expected.length
  });

  const results: EvalResult[] = [];

  for (const q of queries) {
    const exp: any = expectedById.get(q.id);
    const res = await retrievalSearch(q.input as any);

    const requiredDocId = exp?.requiredDocId as string | undefined;
    const top = (res?.topResults ?? []) as Array<{ docId: string; score?: number }>;
    const found = requiredDocId ? top.some(t => t.docId === requiredDocId) : true;

    if (!found) {
      logDebug("smoke.case_failed", {
        id: q.id,
        requiredDocId,
        top5: top.slice(0, 5)
      });
    }

    results.push({
      id: q.id,
      passed: found,
      reason: found ? undefined : "requiredDocId missing in topResults",
      details: { requiredDocId, got: top.slice(0, 5) }
    });
  }

  const finishedAt = new Date().toISOString();

  return {
    suiteName: "smoke",
    startedAt,
    finishedAt,
    results,
    passRate: suitePassRate(results)
  };
}
