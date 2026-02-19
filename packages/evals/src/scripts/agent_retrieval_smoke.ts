import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Report = {
  suiteName: string;
  passRate: number;
  count: number;
  results: Array<{
    id: string;
    passed: boolean;
    details?: any;
    error?: string;
  }>;
};

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function main() {
  const suiteName = "agent_retrieval_smoke";

  const agentPath = resolve(process.cwd(), "..", "..", "services", "agents", "retrieval-smoke", "dist", "index.js");
  if (!existsSync(agentPath)) {
    fail(`missing built agent file: ${agentPath}. Did you run: pnpm -C services/agents/retrieval-smoke build ?`);
  }

  // dynamic import of ESM built agent
  const mod = await import(pathToFileURL(agentPath).href);
  if (typeof mod.run !== "function") {
    fail(`agent module missing export "run": ${agentPath}`);
  }

  const cases = [
    {
      id: "q1",
      input: { query: "refund policy", topK: 5 },
      assert: (out: any) => out?.ok === true && out?.data?.hits?.[0]?.docId === "doc_refund_policy",
      details: { requiredDocId: "doc_refund_policy" },
    },
    {
      id: "q2",
      input: { query: "contract adr", topK: 5 },
      assert: (out: any) => out?.ok === true && out?.data?.hits?.[0]?.docId === "doc_contract_adr",
      details: { requiredDocId: "doc_contract_adr" },
    },
  ];

  const results: Report["results"] = [];

  for (const c of cases) {
    try {
      const out = await mod.run(c.input);
      const passed = !!c.assert(out);
      results.push({
        id: c.id,
        passed,
        details: { ...c.details, gotTop: out?.data?.hits?.[0] ?? null },
      });
    } catch (e: any) {
      results.push({ id: c.id, passed: false, error: e?.message ?? String(e) });
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = resolve(reportsDir, "agent_retrieval_smoke.latest.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({ event: "agent_retrieval_smoke.done", outPath, passRate: report.passRate }, null, 2));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((e) => fail(e?.message ?? String(e)));
