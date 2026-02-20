<!-- LAST_UPDATED: 2026-02-19 -->

# Agent Factory MVP — Wayfinder (Single Source of Truth)

> **Purpose:** This document is the authoritative build checklist for the Agent Factory template.
> It defines:
>
> - **What we are building**
> - **What is already implemented**
> - **What remains**
> - **The agent catalog (platform + MVP agents)**
> - **The acceptance tests that must stay green**
>
> If work isn't explicitly captured here, it's scope creep.

---

## Status legend

- [x] Done (implemented + verified passing)
- [~] In progress (partially implemented, not fully verified)
- [ ] Not started

---

## North Star (MVP outcome)

- [ ] You can run **one command** that:
  - [ ] accepts/loads a **Task** (goal + constraints + file scope + mode)
  - [ ] generates a **Plan**
  - [ ] generates a minimal **Patch** (unified diff)
  - [ ] applies patch (unless dry-run)
  - [ ] runs **validations**
  - [ ] prepares a **PR-ready** branch/commit (prints `gh pr create` only if allowed)

---

# A) Current platform state (implemented + verified)

## A1) Repo & toolchain

- [x] pnpm workspace installs succeed (`pnpm install`)
- [x] TypeScript builds work across workspace
- [x] `pnpm factory:health` exists and is green locally

## A2) Factory CLI (`af`)

- [x] `packages/factory` exists
- [x] Root runner script exists: `pnpm af ...`
- [x] Commands exist + verified:
  - [x] `af agent:new <name>`
  - [x] `af agent:list`
  - [x] `af agent:run <name> --input '<json>'`
- [x] `agent:run` prints a deterministic single-line JSON event

## A3) Manifest-driven execution

- [x] Each agent has `services/agents/<name>/agent.json` with `entry: ./dist/index.js`
- [x] Runner loads manifest and imports entry using Windows-safe `pathToFileURL(...).href`

## A4) Shared runtime (no-copy rule)

- [x] `services/agent-runtime` exists and exports runtime wrapper + result contract
- [x] Agents import runtime helpers from `@acme/agent-runtime`
- [x] Guard check exists and is wired into health:
  - [x] `pnpm -C packages/evals check:no-agent-runtime-copies`
- [x] Guard currently reports `matches: 0`

## A5) Deterministic eval suite

- [x] `eval:agent-retrieval-smoke` writes `.reports/agent_retrieval_smoke.latest.json`, exits **2** on assertion failure
- [x] `eval:agent-runner-smoke` writes `.reports/agent_runner_smoke.latest.json`, exits **2** on assertion failure
- [x] Both are wired into `pnpm factory:health`

---

# B) Non-negotiable invariants (do not regress)

## B1) Deterministic CI (no network)

- [x] No network calls in `packages/evals/**`
- [x] Smoke agents used in evals must also be network-free
- [x] Evals are fixture-based and deterministic

## B2) Runtime sharing rule (enforced)

- [x] Agents must import runtime helpers from `@acme/agent-runtime`
- [x] Never copy runtime code into `services/agents/<agent>/src/runtime.ts`
- [x] Enforced by `check:no-agent-runtime-copies` in health

## B3) Windows-first execution

- [x] Dynamic imports use `pathToFileURL(...).href`
- [x] Path resolution is repo-root-based (no bash assumptions)

## B4) Exit codes (standardized)

- [x] `0` success
- [x] `2` assertion/agent/validation failure
- [x] `1` CLI usage / wiring error only

---

# C) Agent catalog (complete list)

> **Infrastructure agents** are for proving platform correctness.
> **MVP agents** deliver repo-changing capability (Repo Patch).

## C1) Infrastructure agents (exist today)

- [x] `esm-smoke` — proves ESM/NodeNext build + import works
- [x] `retrieval-smoke` — deterministic fixture retrieval agent (used by evals)

## C2) Platform packages (exist today)

- [x] `services/agent-runtime` — shared AgentResult + wrap()
- [x] `services/agent-runner` — loads agent.json, imports entry, calls run()
- [x] `packages/factory` — CLI scaffolder + list + run
- [x] `packages/evals` — deterministic checks + evals wired to health
- [x] `packages/contracts` — compatibility/breaking checks gate (already in health)

## C3) MVP agents (to build)

> These are the "real" agents that implement the Repo Patch workflow.

- [ ] `repo-read` (support agent)
  - [ ] locate symbols, files, call paths, references
  - [ ] deterministic ordering in outputs
  - [ ] never runs network calls

- [ ] `plan` (support agent)
  - [ ] task → structured plan JSON
  - [ ] touched files + risk flags + commands

- [ ] `validate` (support agent)
  - [ ] runs allowlisted pnpm command sets
  - [ ] captures outputs to artifacts

- [ ] `git-pr` (support agent)
  - [ ] create branch + commit
  - [ ] print push + optional PR creation commands

- [ ] `repo-patch` (MVP "money" agent)
  - [ ] task → plan → patch → apply → validate → git-ready output
  - [ ] strict safety rails (scope, max files, lockfile rules)
  - [ ] deterministic structure

---

# D) Milestones & acceptance tests

## D0) Platform health gate (must remain green)

- [x] `pnpm factory:health`

### D0 Acceptance tests (run constantly)

- [x] `pnpm -r build`
- [x] `pnpm af agent:list`
- [x] `pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}'`
- [x] `pnpm factory:health`

---

## D1) Manifest schema + validation (next platform step)

> Make the platform contract-driven (not just "it runs").

- [x] Extend `agent.json` with:
  - [x] `inputSchema` (JSON Schema)
  - [x] `outputSchema` (JSON Schema)
  - [x] optional `capabilities[]`
- [x] Add manifest validator library (shared function)
- [x] Add CLI:
  - [x] `af agent:validate <name>`
  - [x] `af agent:validate:all`
- [x] Add eval/guard:
  - [x] `check:agent-manifests`
  - [x] wire into `pnpm factory:health`
- [x] Optional: `af agent:run --validate-input`

### D1 Acceptance tests (verified)

- [x] `pnpm -r build`
- [x] `pnpm af agent:validate retrieval-smoke`
- [x] `pnpm af agent:validate:all`
- [x] `pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}' --validate-input`
- [x] `pnpm -C packages/evals build`
- [x] `pnpm -C packages/evals check:agent-manifests`
- [x] `pnpm factory:health`

---

## D2) Repo Patch MVP contracts (packages/contracts)

- [x] Define Task schema:
  - [x] `taskId`
  - [x] `goal`
  - [x] `constraints[]`
  - [x] `fileScope[]` (paths)
  - [x] `mode` (dry-run/apply/validate/pr-ready)
- [x] Define Plan schema:
  - [x] ordered `steps[]`
  - [x] `touchedFiles[]`
  - [x] `commands[]`
  - [x] `risks[]`
- [x] Define Patch schema:
  - [x] `{ path, unifiedDiff, rationale }[]`
- [x] Define Result schema:
  - [x] `{ ok, correlationId, timings, outputs, errors[] }`

### D2 Acceptance tests (verified)

- [x] `pnpm -C packages/contracts build`
- [x] `pnpm -C packages/contracts check:breaking`
- [x] `pnpm factory:health`

---

## D3a) Repo Patch — Core run(task) + plan + patch + apply

> Core implementation: `repo-patch` agent accepts a Task, produces a Plan,
> generates a minimal unified diff patch, and applies it (unless dry-run mode).

- [x] `af agent:new repo-patch` (scaffold exists)
- [x] `services/agents/repo-patch/agent.json` has valid inputSchema (Task) and outputSchema (Result)
- [x] `run(task)` implementation:
  - [x] accepts Task (from `@acme/contracts`)
  - [x] produces deterministic `plan.json` (Plan from `@acme/contracts`)
  - [x] generates minimal unified diff patches (Patch[] from `@acme/contracts`)
  - [x] applies patches to working tree unless `mode === "dry-run"`
  - [x] returns `AgentResult` with plan + patches in outputs
- [x] dry-run mode: produces plan + patches but does NOT apply them
- [x] agent imports types/helpers from `@acme/contracts` and `@acme/agent-runtime`

### D3a Acceptance tests

```powershell
pnpm -r build
pnpm af agent:validate repo-patch
pnpm af agent:run repo-patch --input '{"taskId":"test-001","goal":"add hello.txt with content hello world","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}' --validate-input
pnpm factory:health
```

Expected: `agent:run` exits 0 and prints a single JSON line with `ok: true`,
containing a plan object and at least one patch entry in outputs.

---

## D3b) Repo Patch — Safety rails

> Add enforcement layers: file scope, max changed files, lockfile protection,
> command allowlisting.

- [ ] Hard file scope enforcement:
  - [x] reject any patch targeting a path NOT in `task.fileScope[]`
  - [x] return `ok: false` with error if scope violated
- [ ] Max changed files:
  - [x] default limit: **10** files per task
  - [x] configurable via `task.constraints[]`
  - [x] return `ok: false` with error if exceeded
- [ ] Lockfile protection:
  - [x] refuse changes to `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
  - [x] unless `task.constraints` includes `"allow-lockfile-changes"`
- [ ] Command allowlisting:
  - [x] only `pnpm -r build`, `pnpm -C <path> <script>` patterns allowed
  - [x] reject shell commands, `rm`, `curl`, `wget`, etc.

### D3b Acceptance tests

```powershell
pnpm -r build
# Scope violation test: file outside scope should fail gracefully
pnpm af agent:run repo-patch --input '{"taskId":"test-scope","goal":"modify out-of-scope file","constraints":[],"fileScope":["src/allowed.ts"],"mode":"dry-run"}' --validate-input
# Verify the output contains ok:false or scope violation error
pnpm factory:health
```

Expected: scope violation returns `ok: false` with descriptive error, exit code 0
(agent completed normally, it chose to report failure).

---

## D3c) Repo Patch — Observability + artifacts

> Every run produces a structured artifact directory for debugging and audit.

- [ ] Generate `correlationId` (UUID v4) per run
- [ ] Create artifact directory: `.factory/runs/<correlationId>/`
- [ ] Write artifacts:
  - [ ] `.factory/runs/<id>/task.json` — input task
  - [ ] `.factory/runs/<id>/plan.json` — generated plan
  - [ ] `.factory/runs/<id>/patches/*.diff` — one file per patch
  - [ ] `.factory/runs/<id>/result.json` — final AgentResult
  - [ ] `.factory/runs/<id>/commands.log` — executed commands + exit codes
- [ ] `result.json` includes `timings` object (startedAt, completedAt, durationMs)
- [ ] All timestamps are ISO 8601 strings (not Date objects — per AGENTS.md)

### D3c Acceptance tests

```powershell
pnpm -r build
pnpm af agent:run repo-patch --input '{"taskId":"test-obs","goal":"add hello.txt","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}'
# Verify artifact directory was created
if (Test-Path ".factory/runs") { Get-ChildItem ".factory/runs" -Recurse | Select-Object FullName } else { Write-Error "No .factory/runs directory" }
pnpm factory:health
```

Expected: `.factory/runs/<id>/` directory exists with task.json, plan.json,
at least one .diff file, and result.json.

---

## D4) Task-oriented CLI entrypoint (human interface)

> Today you have `af agent:*`. MVP requires a task runner.

- [ ] Add: `pnpm factory run --task "<text>" [--dry-run] [--scope <path>]`
- [ ] Output exactly one final JSON line:
  - [ ] `{ event:"factory.result", correlationId, ok, ... }`
- [ ] Exit codes follow invariant (0/2/1)

### D4 Acceptance tests

```powershell
pnpm -r build
pnpm factory run --task "add hello.txt with content hello world" --dry-run --scope hello.txt
pnpm factory:health
```

Expected: exits 0, prints single JSON line with `event: "factory.result"`.

---

## D5) CI (keep velocity, prevent regressions)

- [ ] Add GitHub Actions workflow:
  - [ ] `pnpm install --frozen-lockfile`
  - [ ] `pnpm factory:health`
- [ ] Target runtime < 60s

### D5 Acceptance tests

```powershell
# Verify workflow file exists and is valid YAML
if (Test-Path ".github/workflows/ci.yml") { Write-Output "CI workflow exists" } else { Write-Error "Missing CI workflow" }
pnpm factory:health
```

---

# E) Canonical commands (copy/paste)

## Fast loop

- [x] `pnpm -r build`
- [x] `pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}'`

## Full gate

- [x] `pnpm factory:health`

## Evals

- [x] `pnpm -C packages/evals eval:smoke`
- [x] `pnpm -C packages/evals eval:agent-retrieval-smoke`
- [x] `pnpm -C packages/evals eval:agent-runner-smoke`
- [x] `pnpm -C packages/evals check:no-agent-runtime-copies`

---

# F) Sprint Log

> Codex appends one row per sprint. Do not manually edit.

| Sprint | Milestone | Description                     | Status | Date       |
| ------ | --------- | ------------------------------- | ------ | ---------- |
| —      | D0–D2     | Platform foundation + contracts | PASS   | pre-sprint |
| 1      | D3a       | repo-patch run(task) returns deterministic plan + unified diff patches; dry-run supported | PASS   | 2026-02-20 |
| 2      | D3b       | repo-patch enforces fileScope, max-files, lockfile protection, and command allowlisting | PASS   | 2026-02-20 |
