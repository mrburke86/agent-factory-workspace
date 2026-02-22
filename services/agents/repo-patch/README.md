# repo-patch

## Purpose
`repo-patch` orchestrates a repository patch workflow: gather scoped context, request a plan, generate patches, enforce safety constraints, optionally validate commands, and emit run artifacts under `.factory/runs/<correlationId>/`.

## Manifest
- `id`: `repo-patch`
- `name`: `repo-patch`
- `version`: `0.1.0`
- `entry`: `./dist/index.js`
- `capabilities`: none declared

## Input Schema (`agent.json`)
- `type`: object
- required fields:
  - `taskId`: string
  - `goal`: string
  - `constraints`: string[]
  - `fileScope`: string[]
  - `mode`: string
- `additionalProperties`: `false`

## Output Schema (`agent.json`)
- required fields:
  - `ok`: boolean
  - `correlationId`: string (UUID for `.factory/runs/<correlationId>/`)
  - `timings`: `{ startedAt, finishedAt, durationMs }`
  - `outputs`: array of `{ key, value }` (includes `plan` and `patches`)
  - `errors`: array of `{ code, message }`
- `additionalProperties`: `false`

## Current Runtime Behavior
- Uses `repo-read` and `plan` sub-agents, then creates a deterministic MVP patch for `hello.txt`.
- Applies patches when `mode !== "dry-run"`.
- Runs `validate` unless `mode === "dry-run"` or `constraints` include `skip-validate`.
- Runs `git-pr` only when `mode === "pr-ready"` (dry-run PR metadata generation).

## Safety Constraints
- File scope enforcement: each patch path must match `task.fileScope[]` (exact match or directory-prefix scope).
- Max changed files: default limit is `10`; override with `constraints` entry `max-files:<n>`.
- Lockfile protection: refuses patches to `pnpm-lock.yaml`, `package-lock.json`, or `yarn.lock` unless `allow-lockfile-changes` is present in `constraints`.
- Command allowlisting: planned commands must match one of:
  - `pnpm -r build`
  - `pnpm -C <workspace-path> <script-name>`
  - `pnpm factory:health`
  - `pnpm af <subcommand> [args]`

## Artifact Structure
Each run writes artifacts to `.factory/runs/<correlationId>/`, including:
- `task.json`
- `plan.json` / `repo-read.json` / `validate.json` / `git-pr.json` (stage artifacts)
- `patches/*.diff` (one unified diff per patch, ordered with numeric prefixes)
- `commands.log`
- `result.json`

## Patch Format and Apply Semantics
- Patch entries use unified diff text with `{ path, unifiedDiff, rationale }`.
- Patches are processed in order and safety checks run before apply.
- If apply fails, the run returns `ok: false` with `PATCH_APPLY_FAILED`.

## Usage
```bash
pnpm af agent:run repo-patch --input '{"taskId":"S6-docs","goal":"refresh agent readmes","constraints":["skip-validate"],"fileScope":["services/agents/esm-smoke/README.md","services/agents/repo-patch/README.md","services/agents/retrieval-smoke/README.md"],"mode":"dry-run"}'
```
