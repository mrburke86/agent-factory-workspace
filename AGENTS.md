<!-- VERSION: v4 — 2026-03-14 -->

# Agent Factory Workspace — Core Invariants

## Purpose

This repo maintains the Agent Factory — a two-layer framework for building,
running, and validating autonomous coding agents:

- **Layer 1 (Core):** Model-agnostic agentic pipeline: Plan → Implement → Verify → Integrate → Operate
- **Layer 2 (Project-Specific):** Pluggable configuration modules that parameterise Layer 1 for specific tech stacks
- **Layer 3 (Autonomy):** Pipeline intelligence — brief intake, task decomposition, orchestrated execution, and error recovery

Core packages and services:

- `packages/factory` — CLI (`pnpm af ...`) to scaffold, list, validate, run agents, and execute pipelines
- `services/agent-runtime` — shared runtime contract/helpers
- `services/agent-runner` — manifest-driven loader/runner
- `services/agents/*` — ESM/NodeNext agents
- `packages/evals` — deterministic CI evals and checks
- `packages/contracts` — versioned schema contracts with breaking-change detection

`SPRINT_PLAN_v4.md` is the transformation checklist and source of truth.

---

## Two-Layer Architecture

### Layer 1: Core Pipeline

Layer 1 provides five reusable pipeline stages that are model-agnostic and
project-independent:

| Stage         | Purpose                                                           | Key Artifacts                                      |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **Plan**      | Transform a task into a structured execution plan                 | `plan.json` (steps, touchedFiles, commands, risks) |
| **Implement** | Generate code changes as unified diff patches                     | `patches/*.diff` (one per changed file)            |
| **Verify**    | Run allowlisted validation commands and capture results           | `validate.json` (command results, pass/fail)       |
| **Integrate** | Orchestrate sub-agents end-to-end, apply patches, prepare commits | `result.json`, `git-pr.json`                       |
| **Operate**   | CI health gates, eval suites, runtime monitoring                  | `.reports/*.latest.json`                           |

Layer 1 code lives in:

- `services/agents/` — individual agent implementations per stage
- `services/agent-runtime/` — shared runtime contract
- `services/agent-runner/` — manifest-driven execution engine
- `packages/factory/` — CLI orchestration
- `packages/contracts/` — schema definitions
- `packages/evals/` — deterministic verification

### Layer 2: Project-Specific Components

Layer 2 components provide configuration that parameterises Layer 1 for a given
tech stack. As of Phase 3, Layer 2 configs exist in two formats:

- **Documentation format:** `docs/examples/*.md` — human-readable markdown
- **Machine-readable format:** `docs/examples/*.json` — runtime-consumable JSON validated against `packages/contracts/src/schemas/layer2-config.schema.ts`

Layer 2 template schema is defined in `docs/templates/layer2-config-schema.md`
and its machine-readable equivalent in `packages/contracts`.

Each Layer 2 example demonstrates how to configure every Layer 1 stage for a
specific technology stack (e.g., Next.js + Postgres, Python + Click).

### How Layer 2 Parameterises Layer 1

Layer 2 configurations provide:

1. **Project metadata** — name, tech stack identifiers, language, framework
2. **Stage overrides** — per-stage prompt templates, constraints, and expected output formats
3. **Validation rules** — project-specific acceptance criteria and health checks
4. **Expected outputs** — what each stage should produce for this particular project type

The mapping: Layer 2 config values are consumed by the orchestrator agent
(Phase 3) or by the sprint loop operator (Phase 2 workflow), which feeds them
into prompts targeting the appropriate Layer 1 stage.

---

## Layer 2 Interface Contract

### Required Fields

Every Layer 2 configuration must declare:

| Field         | Type   | Description                                                                           |
| ------------- | ------ | ------------------------------------------------------------------------------------- |
| `projectName` | string | Human-readable project identifier                                                     |
| `techStack`   | object | `{ language, framework, database?, auth?, payments? }`                                |
| `stages`      | object | Per-stage overrides keyed by stage name (plan, implement, verify, integrate, operate) |

### Stage Override Structure

Each stage override in the `stages` object must include:

| Field                | Type     | Description                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------- |
| `promptTemplate`     | string   | Stage-specific prompt template with `{{placeholders}}` for runtime values |
| `constraints`        | string[] | Hard constraints for this stage (e.g., "no ORM queries in plan stage")    |
| `expectedOutputs`    | string[] | What this stage should produce (e.g., "migration file", "API route")      |
| `acceptanceCriteria` | string[] | Binary pass/fail conditions for stage completion                          |

### Discovery and Loading

- **Markdown format:** Discovered by scanning `docs/examples/*.md` for files
  containing a `## Layer 2 Configuration` section.
- **JSON format:** Discovered by scanning `docs/examples/*.json` and validated
  against `packages/contracts/src/schemas/layer2-config.schema.json` at runtime.
- Each config file is self-contained — no external dependencies.
- The `l2-config-validate` agent validates JSON configs against the schema.

### Validation Rules

A valid Layer 2 config must satisfy:

1. All required fields are present and non-empty.
2. The `stages` object includes at least `plan` and `implement` overrides.
3. Every `promptTemplate` contains at least one `{{placeholder}}`.
4. Every stage lists at least one `acceptanceCriteria` item.
5. No stage override references files or commands outside the project's declared tech stack.

---

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
- `pnpm af pipeline:run --brief '<text>' --l2-config <path>` _(Phase 3)_

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
- This invariant exists because CI uses `--frozen-lockfile` by default, which
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
> repository files.

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

## Orchestrator Invariants (Phase 3)

> These invariants apply to the orchestrator agent and the autonomous pipeline.

### Pipeline Execution Model

The orchestrator chains pipeline stages for atomic tasks:

```
context-gather → plan → repo-patch → validate → git-pr
```

- Stage ordering is fixed and matches the Layer 1 pipeline definition.
- Each stage's output is validated against `packages/contracts` schemas before
  being passed to the next stage.
- All intermediate results are written to `.factory/runs/<correlationId>/`.

### Retry and Recovery Caps (non-negotiable)

- **Max retries per agent per task:** 3
- **Max total retries per pipeline run:** 10
- These caps are hard limits enforced by the orchestrator, not the individual agents.
- The `error-recover` agent proposes recovery actions; the orchestrator enforces caps.
- When caps are exceeded, the orchestrator escalates to the user (returns `ok: false`
  with structured error details).

### Task Decomposition Limits

- **Max tasks per pipeline run:** 15
- **Target task granularity:** 1–3 files per task (aligned with `repo-patch` defaults)
- Tasks must have no circular dependencies (topological sort validation).
- Independent tasks execute sequentially in MVP (no parallelism).

### Failure Propagation

- If a task fails and is a dependency of downstream tasks, all downstream tasks
  are **skipped** (not attempted).
- Skipped tasks are recorded in the pipeline result with status `SKIPPED` and
  a reference to the failed upstream task.
- The orchestrator continues executing independent tasks that are not blocked.

### Token Budget Tracking

- Each pipeline run tracks cumulative token usage per stage.
- A hard token limit per run may be configured in the L2 config.
- Budget exhaustion triggers pipeline halt with structured budget report.

### Multi-Task Artifact Structure

Multi-task pipeline runs produce artifacts at:

```
.factory/runs/<pipelineId>/
├── pipeline.json          # Pipeline metadata + overall result
├── tasks/
│   ├── <taskId-1>/        # Per-task artifact directory (same as repo-patch)
│   │   ├── task.json
│   │   ├── plan.json
│   │   ├── patches/
│   │   ├── result.json
│   │   └── commands.log
│   └── <taskId-2>/
│       └── ...
└── progress.jsonl         # Structured progress events (one per line)
```

### Clarification Protocol

- The `brief-intake` agent may produce `clarifyingQuestions[]` in its output.
- When questions are present, the pipeline **halts** and presents questions to the user.
- Pipeline resumes only after the user provides answers.
- Max clarifying questions per brief: **5** (prioritised by decision impact).
- Question priority: security > architecture > features > UX.

### Brief Intake Constraints

- `structuredBrief` output must include: `projectName`, `techStack` (inferred),
  `features[]`, `constraints[]`, `userStories[]`.
- A fully-specified brief (no ambiguities) must produce **0** clarifying questions.
- An ambiguous brief must produce **≥1** clarifying question.

### Context Gathering Constraints

- File discovery respects `.gitignore` and skips: `node_modules`, `dist`, `.factory`.
- Relevance scoring is heuristic-based (no network calls, no embeddings in MVP).
- Scoring factors: filename keyword match, directory proximity, import graph (static analysis).
- No network calls in the scoring heuristic (deterministic CI invariant).

### Error Recovery Taxonomy

The `error-recover` agent extends the existing Error Taxonomy with recovery actions:

| Error Class          | Recovery Strategy                                     |
| -------------------- | ----------------------------------------------------- |
| `BUILD_ERROR`        | Retry with modified input (fix type/import errors)    |
| `TEST_FAILURE`       | Retry with implementation fix (not test fix)          |
| `SCHEMA_ERROR`       | Retry with schema-aligned output                      |
| `MISSING_FILE`       | Retry after creating missing file                     |
| `PATCH_FAILURE`      | Rollback to last good state, re-plan                  |
| `VALIDATION_FAILURE` | Retry with corrected implementation                   |
| `BUDGET_EXCEEDED`    | Escalate to user (non-recoverable)                    |
| `DEPENDENCY_FAILED`  | Skip downstream tasks (non-recoverable for this task) |
| `MAX_RETRIES`        | Escalate to user (non-recoverable)                    |

Recovery action types: `retry_modified`, `rollback`, `skip_and_flag`, `escalate`.

---

## Code Generation Invariants (Phase 4)

> These invariants apply to all code generation agents introduced in Phase 4
> (S17–S24) and to the full-stack generation pipeline.

### Generation Agent Contract

Code generation agents (`code-gen`, `project-scaffold`, `db-schema`, `api-gen`,
`ui-gen`, `auth-scaffold`, `payments-gen`) follow the standard agent contract
(`run(input)` returning `AgentResult`) with these additional constraints:

- **File scope enforcement:** Generated file paths MUST fall within the declared
  `outputDir` or project root. Agents MUST NOT write outside the target project
  directory.
- **Compile validation:** Every generated TypeScript/TSX file MUST pass
  `tsc --noEmit` as part of the agent's internal verification. Agents return
  `ok: false` if generated code does not compile.
- **Language detection:** File language is inferred from extension. Agents MUST
  set the `language` field on every `GeneratedFile` output entry.
- **Multi-file atomicity:** If an agent generates multiple files and any single
  file fails validation, none of the files are emitted. Generation is atomic.

### Task Classification Types

The orchestrator classifies generation tasks using these formal types, extending
the `TaskClassification` schema from S15:

| Classification   | Description                                      | Agent              |
| ---------------- | ------------------------------------------------ | ------------------ |
| `scaffold`       | Initial project skeleton from L2 config          | `project-scaffold` |
| `schema_gen`     | Database schema and migration generation         | `db-schema`        |
| `route_gen`      | API route handler generation                     | `api-gen`          |
| `component_gen`  | Frontend UI component generation                 | `ui-gen`           |
| `auth_config`    | Authentication configuration and flow generation | `auth-scaffold`    |
| `payment_config` | Payment integration and webhook generation       | `payments-gen`     |

Task classification feeds Phase 5's task-type-aware quality gates.

### Generation Pipeline Stage Order

The full-stack generation pipeline chains agents in this fixed order:

```
project-scaffold → db-schema → api-gen → ui-gen → auth-scaffold → payments-gen
```

- Stage ordering is fixed; the orchestrator enforces sequencing.
- Each stage's output is validated against `packages/contracts` schemas before
  the next stage begins.
- All generation artifacts are written to `.factory/runs/<correlationId>/`.
- The generation pipeline operates within the Phase 3 orchestrator — it does
  NOT introduce a second orchestration system.

### Decision Logging for Supervised/Human-Required Decisions

Generation agents that involve supervised or human-required decisions (per the
Autonomy Taxonomy) MUST log all such decisions via the S14 `DecisionLogEntry`
interface:

| Agent           | Human-Required Decisions          | Supervised Decisions    |
| --------------- | --------------------------------- | ----------------------- |
| `auth-scaffold` | Auth strategy, provider selection | —                       |
| `payments-gen`  | Payment model architecture        | Webhook event selection |

- Full autonomy decisions (e.g., Stripe API version, implementation details)
  are NOT logged.
- Decision log entries feed delivery summaries in Phase 6.
- Agents MUST NOT invent agent-specific decision systems — use the shared
  `DecisionLogEntry` interface from S14.

### Cross-Cutting Compliance (Phase 4)

All Phase 4 agents MUST comply with these constraints:

1. **One retry/recovery subsystem:** Failures route through the S13
   `error-recover` agent and `RecoveryStrategy` contract. No agent may create
   a parallel retry mechanism.
2. **One event model:** Runtime events use the S14 `RuntimeEvent` schema.
   No agent may create a parallel event emission system.
3. **One decision-log interface:** Supervised and human-required decisions
   use the S14 `DecisionLogEntry` interface. No agent may create a parallel
   decision-logging mechanism.
4. **Context partitioning:** Generation agents receive only the context
   relevant to their task (e.g., `api-gen` receives route spec and schema
   references, not the full project narrative). The orchestrator manages
   context envelopes.

### Contract Consumers (Phase 4)

The following Phase 4 agents consume existing contracts:

| Contract             | Phase 4 Consumers                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `RecoveryStrategy`   | `code-gen`, `project-scaffold`, `db-schema`, `api-gen`, `ui-gen`, `auth-scaffold`, `payments-gen` |
| `RuntimeEvent`       | `code-gen`, `project-scaffold`, `db-schema`, `api-gen`, `ui-gen`, `auth-scaffold`, `payments-gen` |
| `DecisionLogEntry`   | `auth-scaffold`, `payments-gen`                                                                   |
| `TaskClassification` | Orchestrator (extended with Phase 4 types)                                                        |

New contracts introduced in Phase 4:

| Contract        | Defined In | Consumers                      |
| --------------- | ---------- | ------------------------------ |
| `FileSpec`      | S17        | `code-gen`, `project-scaffold` |
| `GeneratedFile` | S17        | All Phase 4 generation agents  |

---

## Autonomy Taxonomy (Phase 3)

> Defines which decisions can be made autonomously vs. which require human input.

| Decision Level     | Description                      | Examples                                                                       |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| **Full autonomy**  | Agent decides without user input | Retry caps, task granularity, pipeline stage ordering, question priority model |
| **Supervised**     | Agent proposes, user confirms    | Architecture decisions, security-impacting changes, scope changes              |
| **Human-required** | Must involve user                | Business logic decisions, external service credentials, deployment targets     |

The `brief-intake` agent generates clarifying questions ONLY for Supervised and
Human-required decisions. Full autonomy decisions are never surfaced as questions.

---

## Cross-Cutting Principles (Phase 3+)

1. **Determinism first** — All agents produce identical output for identical input. No network calls, no randomness, no timestamps in logic paths.
2. **Contract-mediated handoffs** — Every inter-agent data flow is validated against `packages/contracts` schemas at both producer and consumer boundaries.
3. **Fail-fast with structured errors** — Agents return `ok: false` with machine-readable error details rather than throwing unstructured exceptions.
4. **Additive evolution** — New schemas and capabilities are additive. Breaking changes require explicit contract migration.
5. **Offline-first evaluation** — All evals run without network access, using fixture data and deterministic assertions.
6. **Minimal authority** — Each agent operates only on its declared inputs and produces only its declared outputs. No side effects outside the artifact directory.

## Contract Governance (Phase 3+)

1. **Evolution rules** — Schemas evolve via additive changes only. Removing or renaming fields is a breaking change requiring a version bump and consumer migration.
2. **Consumer inventory** — Each schema in `packages/contracts` documents which agents consume it (in the schema file's JSDoc or a co-located `CONSUMERS.md`).
3. **Replay safety** — Contract changes must not invalidate existing fixture data in `packages/evals/fixtures/`. If a schema change requires fixture updates, both must ship in the same sprint.
4. **State transitions** — Pipeline stage transitions (e.g., plan → implement) are governed by output schema validation. A stage cannot advance until its output passes schema validation.
5. **Stage-input manifest** — Each pipeline stage declares its required input schemas in `agent.json`. The orchestrator validates input availability before invoking a stage.

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
- `SPRINT_PLAN_v4.md` and `AGENTS.md` are updated by Codex, never manually.
- Sprint results are logged in the Sprint Log table in `SPRINT_PLAN_v4.md`.
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

---
