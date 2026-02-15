import crypto from "node:crypto";
import type { EvalRunReport, EvalSuiteReport, EvalResult } from "./types.js";

export async function runSuites(
  suiteFns: Array<() => Promise<EvalSuiteReport>>
): Promise<EvalRunReport> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const suites: EvalSuiteReport[] = [];
  for (const fn of suiteFns) suites.push(await fn());

  const finishedAt = new Date().toISOString();

  const all = suites.flatMap(s => s.results);
  const passed = all.filter(r => r.passed).length;
  const overallPassRate = all.length ? passed / all.length : 1;

  return { runId, startedAt, finishedAt, suites, overallPassRate };
}

export function assertPassRate(report: EvalRunReport, minPassRate: number) {
  if (report.overallPassRate < minPassRate) {
    throw new Error(
      `EVAL FAIL: overallPassRate ${report.overallPassRate.toFixed(3)} < ${minPassRate}\n` +
      JSON.stringify(report, null, 2)
    );
  }
}

export function suitePassRate(results: EvalResult[]): number {
  if (!results.length) return 1;
  const passed = results.filter(r => r.passed).length;
  return passed / results.length;
}
