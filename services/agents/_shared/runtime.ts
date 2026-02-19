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

export function nowIso(): string {
  return new Date().toISOString();
}

export function msBetween(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs);
}

export async function wrap<TInput, TData>(
  agent: string,
  fn: (input: TInput) => Promise<TData>,
  input: TInput,
): Promise<AgentResult<TData>> {
  const startedAt = nowIso();
  const start = Date.now();

  try {
    const data = await fn(input);
    const end = Date.now();
    const finishedAt = nowIso();

    return {
      ok: true,
      agent,
      startedAt,
      finishedAt,
      ms: msBetween(start, end),
      errors: [],
      data,
    };
  } catch (e: any) {
    const end = Date.now();
    const finishedAt = nowIso();

    const message =
      typeof e?.message === "string"
        ? e.message
        : typeof e === "string"
          ? e
          : JSON.stringify(e);

    return {
      ok: false,
      agent,
      startedAt,
      finishedAt,
      ms: msBetween(start, end),
      errors: [{ code: "UNHANDLED", message }],
    };
  }
}
