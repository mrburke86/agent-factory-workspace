export type AgentInput = Record<string, unknown>;
export type AgentOutput = Record<string, unknown>;

export async function run(input: AgentInput): Promise<AgentOutput> {
  return { ok: true, agent: "retrieval-smoke", input };
}
