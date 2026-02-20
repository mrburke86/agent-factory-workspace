<!-- VERSION: 2026-02-19 -->

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

---

## Repo Patch Agent Invariants

> These invariants apply to the `repo-patch` agent and any agent that modifies
> repository files. Enforced starting at milestone D3a.

### File Scope Enforcement

- Every `repo-patch` run receives a `task.fileScope[]` array.
- The agent MUST reject (return `ok: false`) any patch targeting a path NOT
  listed in `fileScope[]`.
- Glob patterns in `fileScope` are NOT supported in MVP — paths are exact matches
  or directory prefixes (e.g., `src/` matches `src/foo.ts`).
- The agent MUST NOT modify files outside the repo working tree.

### Max Changed Files

- Default limit: **10 files** per task.
- Overridable via `task.constraints[]` with `"max-files:<n>"` format.
- If the generated patch set exceeds the limit, the agent returns `ok: false`
  with a descriptive error.

### Lockfile Protection

- The agent MUST refuse to modify lockfiles (`pnpm-lock.yaml`,
  `package-lock.json`, `yarn.lock`) unless `task.constraints[]` includes
  `"allow-lockfile-changes"`.

### Command Allowlisting

- The agent may only execute commands matching these patterns:
  - `pnpm -r build`
  - `pnpm -C <workspace-path> <script-name>`
  - `pnpm factory:health`
  - `pnpm af <subcommand> [args]`
- All other commands (shell commands, `rm`, `curl`, `wget`, `npm`, `npx`, etc.)
  are forbidden.
- The allowlist is checked before execution, not after.

### Artifact Directory Structure

Every `repo-patch` run produces artifacts at `.factory/runs/<correlationId>/`:

```
.factory/runs/<uuid>/
├── task.json          # Input task (verbatim)
├── plan.json          # Generated plan
├── patches/           # One .diff file per changed file
│   ├── 001-<filename>.diff
│   └── 002-<filename>.diff
├── result.json        # Final AgentResult
└── commands.log       # Commands executed + exit codes
```

- `correlationId` is a UUID v4 generated at run start.
- All timestamps in artifacts are ISO 8601 strings (never `Date` objects).
- Artifact directory is created even for dry-run mode.

### Patch Format

- Patches are unified diff format.
- Each patch entry includes: `{ path, unifiedDiff, rationale }`.
- Patches are applied in array order.
- Patch application is atomic: if any patch fails to apply, none are applied
  and the agent returns `ok: false`.

---

## Sprint Protocol

> Defines the Codex ↔ PowerShell ↔ Claude feedback loop used to build this
> repo incrementally. This is an invariant of the development process.

### Loop Actors

| Actor              | Role                                                       |
| ------------------ | ---------------------------------------------------------- |
| **Claude Project** | Prompt compiler — analyzes state, emits next Codex prompt  |
| **Codex**          | Executor — implements one milestone, updates docs, commits |
| **PowerShell**     | Verifier — runs acceptance commands, captures exit codes   |
| **User**           | Loop operator — pastes outputs between systems             |

### Loop Sequence

1. User pastes prior Codex Output + PowerShell Verification into Claude.
2. Claude classifies gate (PASS/FAIL), resolves conflicts, selects next milestone.
3. Claude emits a populated Codex prompt (single milestone, ≤4,000 tokens).
4. User pastes prompt into Codex. Codex executes the sprint.
5. User runs PowerShell verification commands from Codex output.
6. User pastes both outputs back into Claude. Loop repeats.

### Ground Truth Rule

PowerShell verification output is the sole source of truth for gate status.
If Codex claims PASS but PowerShell shows a non-zero exit code, the gate is FAIL.

### Sprint Constraints

- One milestone per sprint (never combine).
- Milestones are sequential — no skipping.
- Each sprint produces exactly one commit (or zero if no code changed).
- `AGENT_FACTORY_MVP.md` and `AGENTS.md` are updated by Codex, never manually.
- Sprint results are logged in `AGENT_FACTORY_MVP.md` section `F) Sprint Log`.
