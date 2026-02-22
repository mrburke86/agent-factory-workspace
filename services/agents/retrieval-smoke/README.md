# retrieval-smoke

## Purpose
`retrieval-smoke` is a deterministic fixture retrieval agent used to validate retrieval wiring without network or external services.

## Manifest
- `id`: `retrieval-smoke`
- `name`: `retrieval-smoke`
- `version`: `0.1.0`
- `entry`: `./dist/index.js`
- `capabilities`: `["retrieval", "deterministic", "smoke-test"]`

## Input Schema (`agent.json`)
- `type`: object
- `properties`:
  - `query`: string (required)
  - `topK`: number (optional)
- `required`: `["query"]`
- `additionalProperties`: `false`

## Output Schema (`agent.json`)
- top-level required fields: `ok` (boolean), `agent` (string), `ms` (number), `errors` (array of `{ code, message }`)
- `data.hits`: required array of `{ docId: string, score: number }`
- additional top-level fields are allowed (`additionalProperties: true`)

## Runtime Behavior
The agent scores a fixed in-memory fixture corpus (`doc_refund_policy`, `doc_contract_adr`, `doc_shipping`) using token containment and returns the highest scoring hits, truncated to `topK` (default `5`).

## Usage
```bash
pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}'
```

## Role in Evals
- `pnpm -C packages/evals eval:agent-retrieval-smoke` imports `services/agents/retrieval-smoke/dist/index.js` and checks deterministic top hits.
- `pnpm -C packages/evals eval:agent-runner-smoke` runs `pnpm af agent:run retrieval-smoke ...` through the CLI/runner path to verify end-to-end agent execution.
