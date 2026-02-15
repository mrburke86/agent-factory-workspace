export type EvalCase = {
  id: string;
  input: unknown;
  expected: unknown;
  tags?: string[];
};

export type EvalResult = {
  id: string;
  passed: boolean;
  score?: number;
  reason?: string;
  details?: Record<string, unknown>;
};

export type EvalSuiteReport = {
  suiteName: string;
  startedAt: string;
  finishedAt: string;
  results: EvalResult[];
  passRate: number;
};

export type EvalRunReport = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  suites: EvalSuiteReport[];
  overallPassRate: number;
};
