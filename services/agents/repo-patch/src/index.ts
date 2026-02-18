import { wrap, type AgentResult } from "@acme/agent-runtime";

export type AgentInput = Record<string, unknown>;
export type AgentData = Record<string, unknown>;

const AGENT_NAME = "repo-patch";

async function runImpl(input: AgentInput): Promise<AgentData> {
  return { input };
}

export async function run(input: AgentInput): Promise<AgentResult<AgentData>> {
  return wrap<AgentInput, AgentData>(AGENT_NAME, runImpl, input);
}
