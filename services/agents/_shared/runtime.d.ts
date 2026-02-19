export type AgentError = {
  code: string;
  message: string;
};

export type AgentResult<TData = unknown> = {
  ok: boolean;
  agent: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  errors: AgentError[];
  data?: TData;
};

export declare function nowIso(): string;

export declare function msBetween(startMs: number, endMs: number): number;

export declare function wrap<TInput, TData>(
  agent: string,
  fn: (input: TInput) => Promise<TData>,
  input: TInput,
): Promise<AgentResult<TData>>;
