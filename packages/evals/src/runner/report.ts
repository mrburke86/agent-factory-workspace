import type { EvalRunReport } from "./types.js";

export function computeOverallPassRate(report: EvalRunReport): number {
  const all = report.suites.flatMap(s => s.results);
  if (!all.length) return 1;
  const passed = all.filter(r => r.passed).length;
  return passed / all.length;
}
