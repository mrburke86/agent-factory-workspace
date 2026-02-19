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

function toMessage(e: unknown): string {
  if (typeof (e as { message?: unknown })?.message === "string") {
    return (e as { message: string }).message;
  }
  if (typeof e === "string") {
    return e;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
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
  } catch (e) {
    const end = Date.now();
    const finishedAt = nowIso();
    return {
      ok: false,
      agent,
      startedAt,
      finishedAt,
      ms: msBetween(start, end),
      errors: [{ code: "UNHANDLED", message: toMessage(e) }],
    };
  }
}
