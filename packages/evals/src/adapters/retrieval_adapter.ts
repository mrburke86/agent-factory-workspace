import { logInfo } from "../runner/logger.js";

type RetrievalInput = { query: string; topK?: number };
type RetrievalOutput = { topResults: Array<{ docId: string; score: number }> };

const MODE = process.env.EVAL_RETRIEVAL_MODE || "fixture";
const DEFAULT_ENDPOINT = process.env.RETRIEVAL_ENDPOINT || "http://localhost:3000/api/retrieval/search";

export async function retrievalSearch(input: RetrievalInput): Promise<RetrievalOutput> {
  logInfo("retrieval.call", {
    mode: MODE,
    endpoint: DEFAULT_ENDPOINT,
    queryLen: input?.query?.length ?? 0,
    topK: input?.topK
  });

  // v1 fixture mode: deterministic stub (keeps template stable)
  if (MODE === "fixture") {
    const q = (input.query || "").toLowerCase();
    if (q.includes("refund")) return { topResults: [{ docId: "doc_refund_policy", score: 1 }] };
    if (q.includes("approved") || q.includes("contract")) return { topResults: [{ docId: "doc_contract_adr", score: 1 }] };
    return { topResults: [] };
  }

  // live mode
  const resp = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`retrievalSearch failed: ${resp.status} ${text}`);
  }

  return (await resp.json()) as RetrievalOutput;
}
