# Agent Factory Workspace — Core Invariants

## Purpose

This repo maintains the Agent Factory core template:

- `packages/factory` — CLI (`pnpm af ...`) to scaffold, list, validate, and run agents
- `services/agent-runtime` — shared runtime contract/helpers
- `services/agent-runner` — manifest-driven loader/runner
- `services/agents/*` — ESM/NodeNext agents
- `packages/evals` — deterministic CI evals and checks

`AGENT_FACTORY_MVP.md` is the implementation checklist and source of truth.

## Non-Negotiables

- Deterministic CI: no network calls in evals or smoke agents.
- Small, surgical diffs.
- Keep `pnpm factory:health` green.

## Agent Contract

Agents must export:

- `run(input)` returning `AgentResult`

`AgentResult` timestamp fields must be ISO date-time strings, not `Date` objects.

Runtime import invariant:

- Use `@acme/agent-runtime` only.
- Do not copy per-agent runtime helpers.

## Manifest Invariants

Each agent lives at `services/agents/<name>/` and must include `agent.json` with:

- `id`, `name`, `version`, `entry`
- `inputSchema`
- `outputSchema`
- optional `capabilities` (string array)

## Runner / Platform Invariants

- Agent execution is manifest-driven via `@acme/agent-runner`.
- Windows-safe dynamic import is required: `pathToFileURL(resolvedEntryPath).href`.
- Runner validates manifest shape via `validateManifest()`.
- Runtime input validation helper exists via `validateInputAgainstSchema()`.

## CLI Invariants

Supported deterministic commands include:

- `pnpm af agent:list`
- `pnpm af agent:run <name> --input '<json>' [--validate-input]`
- `pnpm af agent:validate <name>`
- `pnpm af agent:validate:all`

Validation commands and run output must stay deterministic (single JSON event line per command result).

Exit code invariant:

- `0` success
- `2` assertion/validation failure
- `1` usage/wiring/runtime invocation error

## CI / Health Invariants

- `packages/evals` provides `check:agent-manifests`.
- `check:agent-manifests` writes `packages/evals/.reports/check_agent_manifests.latest.json`.
- `pnpm factory:health` must run `pnpm -C packages/evals check:agent-manifests` before agent eval suites.

## Command Style

Use `pnpm -C <path> <script>` formatting for workspace path execution.
