<!-- VERSION: 2026-02-20 -->

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

Each agent lives at `services/agents/<n>/` and must include `agent.json` with:

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
- `pnpm af agent:run <n> --input '<json>' [--validate-input]`
- `pnpm af agent:validate <n>`
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

### Lockfile Invariant (CI-critical)

The `pnpm-lock.yaml` at repo root MUST stay in sync with ALL `package.json`
files across the workspace. This is enforced by `--frozen-lockfile` in CI.

Rules:

- If a sprint modifies ANY `package.json` (dependencies, devDependencies,
  scripts, or metadata), the sprint MUST run `pnpm install` to regenerate
  `pnpm-lock.yaml` and include the updated lockfile in the commit.
- Local verification MUST run `pnpm install --frozen-lockfile` as the FIRST
  command before `pnpm -r build`. If it fails, the lockfile is stale.
- This invariant exists because CI uses `-frozen-lockfile` by default, which
  correctly rejects stale lockfiles. A sprint that passes locally but fails
  CI due to lockfile drift is a sprint that didn't follow this invariant.

Common violation pattern:

```
Codex adds "@acme/contracts": "workspace:*" to repo-patch/package.json
→ does NOT run pnpm install
→ commits stale pnpm-lock.yaml
→ CI fails with ERR_PNPM_OUTDATED_LOCKFILE
→ every subsequent commit to main also fails until lockfile is fixed
```

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

> Defines the Codex ↔ PowerShell ↔ CI ↔ Claude feedback loop used to build
> this repo incrementally. This is an invariant of the development process.

### Loop Actors

| Actor                 | Role                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Claude Project**    | Prompt compiler — analyzes state from 3 inputs, emits next Codex prompt                       |
| **Codex**             | Executor — implements one milestone, updates docs, commits + pushes                           |
| **PowerShell**        | Local verifier — runs acceptance commands, captures exit codes                                |
| **GitHub Actions CI** | Remote verifier — runs `--frozen-lockfile` install + `factory:health` in clean env            |
| **`gh` CLI**          | Bridge — `gh run watch` blocks until CI completes; `gh run view --log-failed` captures errors |
| **User**              | Loop operator — pastes outputs between systems                                                |

### Loop Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User pastes prior Codex Output + Local PS + CI Output        │
│    into Claude                                                  │
│                           ↓                                     │
│ 2. Claude classifies gate (3-signal: CI > Local > Codex),       │
│    resolves conflicts, selects next milestone                   │
│                           ↓                                     │
│ 3. Claude emits populated Codex prompt (≤4,000 tokens)          │
│                           ↓                                     │
│ 4. User pastes prompt into Codex → Codex executes sprint        │
│                           ↓                                     │
│ 5. User runs local PowerShell verification (verify-sprint.ps1)  │
│                           ↓                                     │
│ 6. If local PASS: Codex has already pushed.                     │
│    User runs CI gate: gh run watch --exit-status                │
│                           ↓                                     │
│ 7a. CI PASS → User pastes all 3 outputs into Claude → loop      │
│ 7b. CI FAIL → User runs gh run view --log-failed                │
│     → pastes all 3 outputs into Claude → Claude emits FIX       │
└─────────────────────────────────────────────────────────────────┘
```

### Ground Truth Priority

```
CI (GitHub Actions)  >  Local PowerShell  >  Codex claim
        ↑                      ↑                   ↑
  most constrained       developer env         self-reported
  (clean, frozen)        (may have cache)      (may be wrong)
```

CI is the most constrained environment: frozen lockfile, clean `node_modules`,
no local state artifacts. If CI fails but local passes, the CI failure reveals
environment assumptions that must be fixed before advancing.

### Sprint Constraints

- One milestone per sprint (never combine).
- Milestones are sequential — no skipping.
- Each sprint produces exactly one commit (or zero if no code changed).
- `AGENT_FACTORY_MVP.md` and `AGENTS.md` are updated by Codex, never manually.
- Sprint results are logged in `AGENT_FACTORY_MVP.md` section `F) Sprint Log`.
- A milestone is only marked complete when BOTH local verification AND CI pass.
- Lockfile drift is treated as a sprint failure, not a CI infrastructure issue.

### `gh` CLI Commands Reference

| Command                      | When to use      | What it does                                                             |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `gh run watch --exit-status` | After every push | Blocks until CI completes; exits 0 on success, non-zero on failure       |
| `gh run view --log-failed`   | After CI failure | Dumps only the failing step logs (paste into Claude)                     |
| `gh run view <id>`           | For details      | Shows full run metadata                                                  |
| `gh run list --limit 5`      | For context      | Lists recent workflow runs with status                                   |
| `gh run rerun <id>`          | Infra flake only | Re-runs a workflow (use only for GitHub infra issues, not code failures) |
