# l2-config-validate

## Purpose
`l2-config-validate` validates a machine-readable Layer 2 JSON configuration file against the Layer 2 contract schema.

## Input Schema (`agent.json`)
- `configPath` (string, required): path to a JSON config file relative to repo root or absolute path.

## Output Schema (`agent.json`)
- `ok` (boolean): `true` when the config is valid.
- `errors` (string[], optional): validation errors when `ok` is `false`.
- `validatedConfig` (object, optional): normalized parsed config when `ok` is `true`.

## Safety Constraints
- Deterministic and local only.
- Reads files only; no network calls and no file mutations.

## Usage
```bash
pnpm af agent:run l2-config-validate --input '{"configPath":"docs/examples/nextjs-micro-saas.json"}' --validate-input
```

```bash
pnpm af agent:run l2-config-validate --input '{"configPath":"packages/evals/fixtures/l2-config/invalid-config.json"}' --validate-input
```
