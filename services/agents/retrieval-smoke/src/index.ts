import { wrap, type AgentResult } from "@acme/agent-runtime";

export type RetrievalHit = {
  docId: string;
  score: number;
};

export type RetrievalData = {
  hits: RetrievalHit[];
};

export type AgentInput = {
  query: string;
  topK?: number;
};

const AGENT_NAME = "retrieval-smoke";

/**
 * Deterministic in-memory fixture corpus.
 * This keeps evals stable and makes CI deterministic.
 */
const FIXTURE_DOCS: Array<{ docId: string; text: string }> = [
  { docId: "doc_refund_policy", text: "Refund policy: refunds within 14 days for eligible purchases." },
  { docId: "doc_contract_adr", text: "Contract ADR: disputes handled via ADR prior to litigation." },
  { docId: "doc_shipping", text: "Shipping: delivery in 3-5 working days, tracking included." },
];

function assertInput(input: AgentInput) {
  if (!input || typeof input !== "object") {
    throw new Error("input must be an object");
  }
  if (!input.query || typeof input.query !== "string") {
    throw new Error("query is required");
  }
}

function score(docText: string, q: string): number {
  const t = docText.toLowerCase();
  const qq = q.toLowerCase();

  // very simple scoring: 1 if query token exists, else 0
  // (deterministic and adequate for smoke)
  const tokens = qq.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) hits += 1;
  }
  return tokens.length === 0 ? 0 : hits / tokens.length;
}

async function runImpl(input: AgentInput): Promise<RetrievalData> {
  assertInput(input);

  const topK = typeof input.topK === "number" && input.topK > 0 ? Math.floor(input.topK) : 5;

  const hits = FIXTURE_DOCS
    .map((d) => ({ docId: d.docId, score: score(d.text, input.query) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { hits };
}

export async function run(input: AgentInput): Promise<AgentResult<RetrievalData>> {
  return wrap<AgentInput, RetrievalData>(AGENT_NAME, runImpl, input);
}

