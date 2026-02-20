<!-- LAST_UPDATED: 2026-02-20 -->

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
  - [x] accepts/loads a **Task** (goal + constraints + file scope + mode)
  - [x] generates a **Plan**
  - [x] generates a minimal **Patch** (unified diff)
  - [x] applies patch (unless dry-run)
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

- [x] `repo-read` (support agent)
  - [x] locate symbols, files, call paths, references
  - [x] deterministic ordering in outputs
  - [x] never runs network calls
- [ ] `plan` (support agent)
  - [ ] task → structured plan JSON
  - [ ] touched files + risk flags + commands
- [ ] `validate` (support agent)
  - [ ] runs allowlisted pnpm command sets
  - [ ] captures outputs to artifacts
- [ ] `git-pr` (support agent)
  - [ ] create branch + commit
  - [ ] print push + optional PR creation commands
- [~] `repo-patch` (MVP "money" agent)
  - [x] task → plan → patch → apply (deterministic stub)
  - [x] strict safety rails (scope, max files, lockfile rules)
  - [x] deterministic structure
  - [ ] task → plan → patch → apply → validate → git-ready output (full orchestration)

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

- [x] Hard file scope enforcement:
  - [x] reject any patch targeting a path NOT in `task.fileScope[]`
  - [x] return `ok: false` with error if scope violated
- [x] Max changed files:
  - [x] default limit: **10** files per task
  - [x] configurable via `task.constraints[]`
  - [x] return `ok: false` with error if exceeded
- [x] Lockfile protection:
  - [x] refuse changes to `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
  - [x] unless `task.constraints` includes `"allow-lockfile-changes"`
- [x] Command allowlisting:
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

- [x] Generate `correlationId` (UUID v4) per run
- [x] Create artifact directory: `.factory/runs/<correlationId>/`
- [x] Write artifacts:
  - [x] `.factory/runs/<id>/task.json` — input task
  - [x] `.factory/runs/<id>/plan.json` — generated plan
  - [x] `.factory/runs/<id>/patches/*.diff` — one file per patch
  - [x] `.factory/runs/<id>/result.json` — final AgentResult
  - [x] `.factory/runs/<id>/commands.log` — executed commands + exit codes
- [x] `result.json` includes `timings` object (startedAt, completedAt, durationMs)
- [x] All timestamps are ISO 8601 strings (not Date objects — per AGENTS.md)

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

- [x] Add: `pnpm factory run --task "<text>" [--dry-run] [--scope <path>]`
- [x] Output exactly one final JSON line:
  - [x] `{ event:"factory.result", correlationId, ok, ... }`
- [x] Exit codes follow invariant (0/2/1)

### D4 Acceptance tests

```powershell
pnpm -r build
pnpm factory run --task "add hello.txt with content hello world" --dry-run --scope hello.txt
pnpm factory:health
```

Expected: exits 0, prints single JSON line with `event: "factory.result"`.

---

## D5) CI (keep velocity, prevent regressions)

- [x] Add GitHub Actions workflow:
  - [x] `pnpm install --frozen-lockfile`
  - [x] `pnpm factory:health`
- [x] Target runtime < 60s

### D5 Acceptance tests

```powershell
# Verify workflow file exists and is valid YAML
if (Test-Path ".github/workflows/ci.yml") { Write-Output "CI workflow exists" } else { Write-Error "Missing CI workflow" }
pnpm factory:health
```

---

## D5a) Lockfile sync fix (prerequisite for D6+)

> `pnpm install --frozen-lockfile` currently fails because
> `services/agents/repo-patch/package.json` added `@acme/contracts`
> without regenerating the lockfile. This must be fixed before any new
> agent scaffolding work, since CI enforces `--frozen-lockfile`.

- [x] Run `pnpm install` to regenerate `pnpm-lock.yaml`
- [x] Verify: `pnpm install --frozen-lockfile` exits 0
- [x] Commit updated `pnpm-lock.yaml`
- [x] CI passes with frozen lockfile

### D5a Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

Expected: all three commands exit 0. `--frozen-lockfile` no longer fails.

---

## D6) repo-read agent — file & symbol lookup

> Deterministic, offline agent that reads the repo working tree and returns
> structured information about files, symbols, and references. This is the
> foundation for intelligent plan generation — the planner needs to know
> what exists before deciding what to change.

- [x] Scaffold: `af agent:new repo-read`
- [x] `services/agents/repo-read/agent.json` with valid inputSchema and outputSchema
- [x] inputSchema accepts:
  - [x] `repoRoot` (string, path to repo root)
  - [x] `queries[]` — array of lookup queries, each with:
    - [x] `type` ∈ `{"file-list", "file-content", "symbol-search", "references"}`
    - [x] `pattern` (string — glob for files, name for symbols)
    - [x] optional `scope` (directory prefix to narrow search)
- [x] outputSchema returns:
  - [x] `results[]` — one entry per query, each with:
    - [x] `queryIndex` (number)
    - [x] `type` (matches input query type)
    - [x] `matches[]` — sorted deterministically (alphabetical by path, then line number)
- [x] `run(input)` implementation:
  - [x] `file-list`: recursive directory listing, respects `.gitignore`, returns sorted paths
  - [x] `file-content`: reads file(s) matching pattern, returns content + line count
  - [x] `symbol-search`: naive grep for export/function/class/interface declarations
  - [x] `references`: grep for import/require statements referencing the pattern
- [x] No network calls (enforced by eval)
- [x] Deterministic output ordering (sorted matches)
- [x] Agent imports from `@acme/agent-runtime` only (no runtime copies)

### D6 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate repo-read
pnpm af agent:run repo-read --input '{"repoRoot":".","queries":[{"type":"file-list","pattern":"*.json","scope":"services/agents/retrieval-smoke"}]}' --validate-input
pnpm af agent:validate:all
pnpm factory:health
```

Expected: `agent:run` exits 0 and prints a single JSON line with deterministic
sorted file matches. `agent:validate:all` still passes (now includes repo-read).

---

## D7) plan agent — task → structured plan

> Deterministic agent that takes a Task (from `@acme/contracts`) and produces
> a Plan (from `@acme/contracts`). In the MVP, planning is rule-based
> (no LLM calls). The planner parses the goal string, determines which files
> to touch, generates step descriptions, and flags risks.

- [ ] Scaffold: `af agent:new plan`
- [ ] `services/agents/plan/agent.json` with valid inputSchema (Task) and outputSchema (Plan)
- [ ] `run(task)` implementation:
  - [ ] parses `task.goal` to determine action type (create file, modify file, delete file)
  - [ ] generates ordered `steps[]` describing the work
  - [ ] populates `touchedFiles[]` from parsed goal + `task.fileScope[]`
  - [ ] generates `commands[]` (empty in dry-run, allowlisted pnpm commands otherwise)
  - [ ] populates `risks[]` (e.g., "writes new file", "modifies existing file")
  - [ ] validates `touchedFiles` against `task.fileScope[]` (returns error if out of scope)
- [ ] No network calls
- [ ] Deterministic output for identical inputs
- [ ] Agent imports from `@acme/contracts` and `@acme/agent-runtime`

### D7 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate plan
pnpm af agent:run plan --input '{"taskId":"plan-001","goal":"add hello.txt with content hello world","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}' --validate-input
pnpm af agent:validate:all
pnpm factory:health
```

Expected: `agent:run` exits 0, prints JSON with a valid Plan containing
`steps[]`, `touchedFiles: ["hello.txt"]`, `commands: []`, and `risks[]`.

---

## D8) validate agent — command execution + output capture

> Agent that runs allowlisted pnpm commands and captures their output.
> Used after patching to verify the repo still builds and passes health checks.
> In MVP, execution is real (not mocked) but constrained to the command allowlist.

- [ ] Scaffold: `af agent:new validate`
- [ ] `services/agents/validate/agent.json` with valid inputSchema and outputSchema
- [ ] inputSchema accepts:
  - [ ] `commands[]` — array of command strings to execute
  - [ ] `repoRoot` (string, working directory for execution)
  - [ ] `artifactDir` (string, path to write output logs)
- [ ] outputSchema returns:
  - [ ] `results[]` — one per command:
    - [ ] `command` (string)
    - [ ] `exitCode` (number)
    - [ ] `stdout` (string, truncated to 10KB)
    - [ ] `stderr` (string, truncated to 10KB)
    - [ ] `durationMs` (number)
  - [ ] `allPassed` (boolean — true if all exitCode === 0)
- [ ] `run(input)` implementation:
  - [ ] validates each command against the allowlist before execution
  - [ ] rejects forbidden commands with `ok: false` and descriptive error
  - [ ] executes commands sequentially via `child_process.execSync` or `spawn`
  - [ ] captures stdout/stderr per command
  - [ ] writes combined output to `artifactDir/commands.log`
  - [ ] returns structured results
- [ ] Command allowlist (same as AGENTS.md):
  - [ ] `pnpm -r build`
  - [ ] `pnpm -C <workspace-path> <script-name>`
  - [ ] `pnpm factory:health`
  - [ ] `pnpm af <subcommand> [args]`
- [ ] No network calls from the agent itself (commands may access filesystem)
- [ ] Agent imports from `@acme/agent-runtime` only

### D8 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate validate
# Run with a simple allowlisted command
pnpm af agent:run validate --input '{"commands":["pnpm -r build"],"repoRoot":".","artifactDir":".factory/test-validate"}' --validate-input
# Verify forbidden command is rejected
pnpm af agent:run validate --input '{"commands":["rm -rf /"],"repoRoot":".","artifactDir":".factory/test-validate-bad"}' --validate-input
pnpm af agent:validate:all
pnpm factory:health
```

Expected: first `agent:run` exits 0 with `allPassed: true`. Second `agent:run`
exits 0 with `ok: false` and a command-rejection error. Forbidden commands are
never executed.

---

## D9) git-pr agent — branch + commit + PR command output

> Agent that prepares a git-ready state: creates a branch, stages changes,
> commits, and prints the `gh pr create` command. In MVP, actual git operations
> are **dry-run only** — the agent returns the commands it _would_ execute
> without running them, unless mode is `"pr-ready"`.

- [ ] Scaffold: `af agent:new git-pr`
- [ ] `services/agents/git-pr/agent.json` with valid inputSchema and outputSchema
- [ ] inputSchema accepts:
  - [ ] `branchName` (string)
  - [ ] `commitMessage` (string)
  - [ ] `patchedFiles[]` (string array — paths that were modified)
  - [ ] `mode` ∈ `{"dry-run", "pr-ready"}`
  - [ ] `repoRoot` (string)
- [ ] outputSchema returns:
  - [ ] `commands[]` — ordered list of git/gh commands generated:
    - [ ] `git checkout -b <branch>`
    - [ ] `git add <file>` (one per patched file)
    - [ ] `git commit -m "<message>"`
    - [ ] `git push origin <branch>`
    - [ ] `gh pr create --title "<title>" --body "<body>"`
  - [ ] `executed` (boolean — true only if mode was `"pr-ready"`)
  - [ ] `branchName` (string)
- [ ] `run(input)` implementation:
  - [ ] generates deterministic command list from input
  - [ ] in `"dry-run"` mode: returns commands without executing any
  - [ ] in `"pr-ready"` mode: executes git commands (NOT `gh pr create` — only prints it)
  - [ ] validates branchName format (no spaces, no special chars beyond `_/`)
- [ ] No network calls (git push/gh pr are printed, not executed in dry-run)
- [ ] Agent imports from `@acme/agent-runtime` only

### D9 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate git-pr
pnpm af agent:run git-pr --input '{"branchName":"factory/test-001","commitMessage":"test: add hello.txt","patchedFiles":["hello.txt"],"mode":"dry-run","repoRoot":"."}' --validate-input
pnpm af agent:validate:all
pnpm factory:health
```

Expected: `agent:run` exits 0, prints JSON with `commands[]` containing
the git/gh command sequence and `executed: false` (dry-run mode).

---

## D10) repo-patch orchestration — wire support agents end-to-end

> Upgrade `repo-patch` from a standalone stub to an orchestrator that calls
> the support agents in sequence: repo-read → plan → patch → validate → git-pr.
> This is the "real" repo-patch that chains agent outputs together.

- [ ] `repo-patch` `run(task)` calls support agents in order:
  - [ ] Step 1: Call `repo-read` to gather context about `task.fileScope[]`
  - [ ] Step 2: Call `plan` with task + repo-read context → produces Plan
  - [ ] Step 3: Generate patches from Plan (existing patch logic)
  - [ ] Step 4: Apply patches (unless dry-run)
  - [ ] Step 5: Call `validate` with `plan.commands` (unless dry-run/validate skipped)
  - [ ] Step 6: Call `git-pr` if mode is `"pr-ready"` (dry-run otherwise)
- [ ] Orchestration uses agent-runner to invoke sub-agents (manifest-driven)
- [ ] Each sub-agent call is logged in artifacts (`commands.log`)
- [ ] If any sub-agent returns `ok: false`, repo-patch stops and returns `ok: false`
- [ ] All existing safety rails (scope, max-files, lockfile) still enforced
- [ ] Artifact directory includes sub-agent outputs:
  - [ ] `.factory/runs/<id>/repo-read.json`
  - [ ] `.factory/runs/<id>/plan.json` (now from plan agent, not inline)
  - [ ] `.factory/runs/<id>/validate.json`
  - [ ] `.factory/runs/<id>/git-pr.json`
- [ ] Backward compatible: existing acceptance tests still pass

### D10 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate repo-patch
# Full orchestration in dry-run
pnpm af agent:run repo-patch --input '{"taskId":"orch-001","goal":"add hello.txt with content hello world","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}' --validate-input
# Verify artifact directory contains sub-agent outputs
if (Test-Path ".factory/runs") { Get-ChildItem ".factory/runs" -Recurse | Select-Object FullName } else { Write-Error "No .factory/runs directory" }
# Existing D3a test still passes
pnpm af agent:run repo-patch --input '{"taskId":"test-001","goal":"add hello.txt with content hello world","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}' --validate-input
pnpm factory:health
```

Expected: `agent:run` exits 0, prints JSON with `ok: true`. Artifact directory
contains `repo-read.json`, `plan.json`, `validate.json` (or skip marker),
and `git-pr.json`. All prior D3a/D3b/D3c tests still pass.

---

## D11) North Star — single command, full pipeline, PR-ready

> Wire the orchestrated `repo-patch` into `factory run` so that one command
> does everything: task → read → plan → patch → apply → validate → git-ready.
> This completes the MVP North Star outcome.

- [ ] `pnpm factory run --task "<text>" --scope <path>` runs full orchestrated pipeline
- [ ] `pnpm factory run --task "<text>" --scope <path> --dry-run` produces plan + patches only
- [ ] `pnpm factory run --task "<text>" --scope <path> --mode pr-ready` produces branch + commit + PR command
- [ ] `factory run` output includes:
  - [ ] `event: "factory.result"`
  - [ ] `correlationId`
  - [ ] `ok` (boolean)
  - [ ] `plan` summary
  - [ ] `patchCount`
  - [ ] `validationPassed` (boolean or null if skipped)
  - [ ] `gitCommands[]` (if pr-ready)
- [ ] Exit codes:
  - [ ] `0` — pipeline succeeded
  - [ ] `2` — validation failed (build broken, scope violation, etc.)
  - [ ] `1` — usage/wiring error
- [ ] All North Star checkboxes can be marked `[x]`

### D11 Acceptance tests

```powershell
pnpm install --frozen-lockfile
pnpm -r build
# Dry-run: full pipeline, no side effects
pnpm factory run --task "add hello.txt with content hello world" --dry-run --scope hello.txt
# Validate mode
pnpm factory run --task "add hello.txt with content hello world" --scope hello.txt --mode validate
# PR-ready mode (dry-run of git commands)
pnpm factory run --task "add hello.txt with content hello world" --scope hello.txt --mode pr-ready
# Verify artifact directory
if (Test-Path ".factory/runs") { Get-ChildItem ".factory/runs" -Recurse -Depth 2 | Select-Object FullName } else { Write-Error "No .factory/runs directory" }
pnpm factory:health
```

Expected: all three `factory run` invocations exit 0 with `event: "factory.result"`
and `ok: true`. PR-ready output includes `gitCommands[]`. Artifact directories
contain full sub-agent outputs.

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

| Sprint | Milestone | Description                                                                                                | Status | Date       |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| —      | D0–D2     | Platform foundation + contracts                                                                            | PASS   | pre-sprint |
| 1      | D3a       | repo-patch run(task) returns deterministic plan + unified diff patches; dry-run supported                  | PASS   | 2026-02-20 |
| 2      | D3b       | repo-patch enforces fileScope, max-files, lockfile protection, and command allowlisting                    | PASS   | 2026-02-20 |
| 3      | D3c       | repo-patch writes .factory/runs/<id> artifacts (task/plan/patches/result/commands) with UUID + ISO timings | PASS   | 2026-02-20 |
| 4      | D4        | factory run CLI accepts --task/--dry-run/--scope and prints factory.result JSON event                      | PASS   | 2026-02-20 |
| 5      | D5        | GitHub Actions CI runs pnpm install--frozen-lockfile + pnpm factory:health under 60s target                | PASS   | 2026-02-20 |
| 6      | D5a       | Lockfile sync — regenerate pnpm-lock.yaml to include @acme/contracts in repo-patch                         | PASS   | 2026-02-20 |
| 7      | D6        | repo-read agent: file-list, file-content, symbol-search, references query types                            | PASS   | 2026-02-20 |
| 8      | D5a       | Lockfile sync verified — frozen-lockfile passes, D5a marked complete                                       | PASS   | 2026-02-20 |
