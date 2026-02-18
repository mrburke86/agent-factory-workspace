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
> If work isn’t explicitly captured here, it’s scope creep.

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

> These are the “real” agents that implement the Repo Patch workflow.

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

- [ ] `repo-patch` (MVP “money” agent)
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

> Make the platform contract-driven (not just “it runs”).

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

## D3) Repo Patch agent (services/agents/repo-patch)

- [x] `af agent:new repo-patch`
- [ ] `run(task)` produces:
  - [ ] deterministic `plan.json`
  - [ ] minimal unified diff patch
  - [ ] applies patch unless dry-run
- [ ] Safety rails:
  - [ ] hard file scope enforcement
  - [ ] max changed files default **10**
  - [ ] refuse lockfile changes unless flag
  - [ ] allowlist commands only
- [ ] Observability + artifacts:
  - [ ] `correlationId` UUID
  - [ ] `.factory/runs/<id>/task.json`
  - [ ] `.factory/runs/<id>/plan.json`
  - [ ] `.factory/runs/<id>/patches/*.diff`
  - [ ] `.factory/runs/<id>/result.json`
  - [ ] `.factory/runs/<id>/commands.log`

### D3 Acceptance tests (target)

- [ ] `pnpm -r build`
- [ ] `pnpm af agent:run repo-patch --input '<task json>'`
- [ ] `pnpm factory:health`

---

## D4) Task-oriented CLI entrypoint (human interface)

> Today you have `af agent:*`. MVP requires a task runner.

- [ ] Add: `pnpm factory run --task "<text>" [--dry-run] [--scope <path>]`
- [ ] Output exactly one final JSON line:
  - [ ] `{ event:"factory.result", correlationId, ok, ... }`
- [ ] Exit codes follow invariant (0/2/1)

### D4 Acceptance tests (target)

- [ ] `pnpm factory run --task "..." --dry-run --scope packages/contracts`
- [ ] `pnpm factory:health`

---

## D5) CI (keep velocity, prevent regressions)

- [ ] Add GitHub Actions workflow:
  - [ ] `pnpm install --frozen-lockfile`
  - [ ] `pnpm factory:health`
- [ ] Target runtime < 60s

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
