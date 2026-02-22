# esm-smoke

## Purpose
`esm-smoke` is a minimal ESM/NodeNext smoke agent used to verify that the agent runner can dynamically load and execute an ESM-built agent module.

## Manifest
- `id`: `esm-smoke`
- `name`: `esm-smoke`
- `version`: `0.1.0`
- `entry`: `./dist/index.js`
- `capabilities`: `["esm", "smoke-test", "echo"]`

## Input Schema (`agent.json`)
- `type`: object
- `properties`:
  - `value`: string (optional)
- `required`: none
- `additionalProperties`: `true`

## Output Schema (`agent.json`)
- top-level required fields: `ok` (boolean), `agent` (string), `ms` (number), `errors` (array of `{ code, message }`)
- optional `data` object with optional `echo` string
- additional top-level fields are allowed (`additionalProperties: true`)

## Runtime Behavior
The implementation wraps `runImpl` with `@acme/agent-runtime` and currently returns `{ input }` as `data`, which exercises ESM loading/execution and wrapper metadata generation.

## Usage
```bash
pnpm af agent:run esm-smoke --input '{"value":"ping"}'
```

## Role in Evals
`packages/evals` validates manifests for all agents (including `esm-smoke`) via `pnpm -C packages/evals check:agent-manifests`, and `esm-smoke` remains the dedicated fixture agent for direct ESM loader smoke checks.
