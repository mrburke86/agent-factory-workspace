<!-- LAST_UPDATED: 2026-02-23 -->

# Agent Factory Phase 3 — Autonomous Pipeline Intelligence — Sprint Plan (Single Source of Truth)

> **Purpose:** This document is the authoritative transformation checklist for
> Phase 3 of the Agent Factory. It defines what will be built, what remains,
> and the acceptance criteria for each sprint. Milestone IDs continue the
> S-prefix sequence from Phase 2 (S1–S8 complete).
>
> **Phase 3 Goal:** The factory can accept a natural-language project brief,
> resolve ambiguities through user interaction, decompose the project into
> atomic tasks, and orchestrate the full pipeline without human loop operation.
>
> **Exit Criteria:**
>
> - A user can type a project brief in natural language and receive a structured, dependency-ordered build plan
> - The orchestrator can chain `plan → implement → verify → integrate` for a single task without manual intervention
> - Error recovery handles at least: build failures, patch application failures, and validation failures
> - `pnpm factory:health` remains green throughout
>
> **Risk Level:** High — this phase fundamentally changes the execution model from human-driven to machine-driven.
>
> If work isn't captured here, it's scope creep.

---

## Status Legend

- [x] Done (implemented + verified passing)
- [~] In progress (partially implemented, not fully verified)
- [ ] Not started

---

## Phase 2 Completion Summary

| Sprint | Milestone | Description                                                   | Gate |
| ------ | --------- | ------------------------------------------------------------- | ---- |
| 1      | S1        | Repo Cleanup — Archive Bootstrap Artefacts                    | PASS |
| 2      | S2        | Install AGENTS.md — Production Architecture Definition        | PASS |
| 3      | S3        | Layer 2 Scaffolding — Directory Structure and Template Schema | PASS |
| 4      | S4        | Layer 2 Example — Next.js Micro-SaaS                          | PASS |
| 5      | S5        | Layer 2 Example — Python CLI Tool                             | PASS |
| 6      | S6        | Agent README Refresh                                          | PASS |
| 7      | S7        | README.md — Comprehensive Onboarding Document                 | PASS |
| 8      | S8        | End-to-End Validation                                         | PASS |

**Phase 2 baseline:** 7 validated agents, 2 Layer 2 examples, comprehensive docs, all health gates green.

---

## Sprint 9: Machine-Readable Layer 2 Configs

**Objective:** Convert Layer 2 configurations from documentation-only markdown to machine-parseable JSON schemas that the pipeline can consume at runtime.

**Prerequisites:** S8 (Phase 2 complete)

**Estimated Effort:** 3 hours

**Milestone Definition:**
The Layer 2 config schema is defined as TypeScript types and exported as JSON Schema in `packages/contracts`. A new `l2-config-validate` agent validates Layer 2 JSON config files against this schema. Machine-readable `.json` equivalents exist alongside the existing `.md` Layer 2 examples. A fixture-based eval tests valid and invalid L2 configs. The schema structure mirrors the existing markdown schema exactly — no redesign.

**Tasks:**

- [x] Create `packages/contracts/src/schemas/layer2-config.schema.ts` — TypeScript type definitions for Layer 2 configs (`Layer2Config`, `StageOverride`, `TechStack`)
- [x] Create build step to export `layer2-config.schema.json` from the TypeScript types (co-located in `packages/contracts/dist/schemas/`)
- [x] Register the new schema exports in `packages/contracts/src/index.ts`
- [x] Create `docs/examples/nextjs-micro-saas.json` — machine-readable JSON equivalent of the existing markdown example
- [x] Create `docs/examples/python-cli-tool.json` — machine-readable JSON equivalent of the existing markdown example
- [x] Scaffold `services/agents/l2-config-validate/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [x] Implement validation logic: load JSON file at `configPath`, validate against schema, return structured errors
- [x] Create eval fixture: `packages/evals/fixtures/l2-config/valid-config.json` and `packages/evals/fixtures/l2-config/invalid-config.json` (missing required fields)
- [x] Create eval script: `packages/evals/scripts/eval_l2_config_validate.js` — runs agent against both fixtures, asserts valid returns `ok: true`, invalid returns `ok: false` with error details
- [x] Add eval to `pnpm factory:health` pipeline
- [x] Verify `pnpm install --frozen-lockfile && pnpm -r build && pnpm factory:health` all pass

**Acceptance Criteria:**

- [x] `packages/contracts/src/schemas/layer2-config.schema.ts` exists and exports `Layer2Config` type
- [x] `packages/contracts/dist/schemas/layer2-config.schema.json` is generated on build
- [x] `services/agents/l2-config-validate/agent.json` exists with valid `inputSchema` and `outputSchema`
- [x] `pnpm af agent:run l2-config-validate --input '{"configPath":"docs/examples/nextjs-micro-saas.json"}' --validate-input` exits 0 with `ok: true`
- [x] `pnpm af agent:run l2-config-validate --input '{"configPath":"packages/evals/fixtures/l2-config/invalid-config.json"}' --validate-input` exits 0 with `ok: false` and structured errors
- [x] `docs/examples/nextjs-micro-saas.json` exists and passes schema validation
- [x] `docs/examples/python-cli-tool.json` exists and passes schema validation
- [x] L2 config eval passes in `pnpm factory:health`
- [x] `pnpm af agent:validate:all` exits 0 (new agent included)
- [x] `packages/contracts` `check:breaking` passes (additive schema only)

**Acceptance Commands:**

```bash
# Verify schema file exists
test -f packages/contracts/src/schemas/layer2-config.schema.ts && echo "PASS: schema TS exists" || echo "FAIL: no schema TS"

# Verify JSON schema is generated on build
pnpm -C packages/contracts build
test -f packages/contracts/dist/schemas/layer2-config.schema.json && echo "PASS: JSON schema generated" || echo "FAIL: no JSON schema"

# Verify agent manifest
test -f services/agents/l2-config-validate/agent.json && echo "PASS: agent manifest exists" || echo "FAIL: no agent manifest"

# Verify JSON examples exist
test -f docs/examples/nextjs-micro-saas.json && echo "PASS: nextjs JSON exists" || echo "FAIL: no nextjs JSON"
test -f docs/examples/python-cli-tool.json && echo "PASS: python JSON exists" || echo "FAIL: no python JSON"

# Run agent against valid config
pnpm af agent:run l2-config-validate --input '{"configPath":"docs/examples/nextjs-micro-saas.json"}' --validate-input

# Run agent against invalid config (should return ok: false)
pnpm af agent:run l2-config-validate --input '{"configPath":"packages/evals/fixtures/l2-config/invalid-config.json"}' --validate-input

# Verify all agents including new one
pnpm af agent:validate:all

# Verify contracts are non-breaking
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 10: Context Gathering Agent

**Objective:** Build an agent that scans a repository and produces a relevance-ranked file map for a given task description.

**Prerequisites:** S8

**Estimated Effort:** 3 hours

**Milestone Definition:**
A new `context-gather` agent exists at `services/agents/context-gather/` with a full manifest, source implementation, and README. The agent accepts a repo root path and task description, traverses the file tree (respecting `.gitignore` and skip patterns), and returns a relevance-ranked list of files with scores and summaries. Scoring is heuristic-based (no network calls) using filename keyword match, directory proximity, and static import graph analysis. A fixture-based eval validates top-5 accuracy.

**Tasks:**

- [x] Scaffold `services/agents/context-gather/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [x] Define input schema: `{ repoRoot: string, taskDescription: string, maxFiles?: number }`
- [x] Define output schema: `{ files: [{ path: string, relevanceScore: number, summary: string }], tokenEstimate: number }`
- [x] Add contract types to `packages/contracts`: `ContextGatherInput`, `ContextGatherOutput`, `RankedFile`
- [x] Implement file discovery: recursive directory traversal, respect `.gitignore`, skip `node_modules`, `dist`, `.factory`, `.git`
- [x] Implement relevance scoring heuristic: filename keyword match (weight: 0.4) + directory proximity to task keywords (weight: 0.3) + import graph edges (weight: 0.3)
- [x] Implement token estimation: approximate token count based on file sizes
- [x] Create eval fixture: `packages/evals/fixtures/context-gather/` — a minimal fixture repo structure with known relevant files for a test task
- [x] Create eval script: `packages/evals/scripts/eval_context_gather.js` — runs agent against fixture, asserts top-5 files include ≥4 of 5 known relevant files (80% accuracy)
- [x] Add eval to `pnpm factory:health` pipeline
- [x] Write README documenting purpose, scoring heuristic, skip patterns, usage examples

**Acceptance Criteria:**

- [x] `services/agents/context-gather/agent.json` exists with valid schemas
- [x] `pnpm af agent:run context-gather --input '{"repoRoot":"packages/evals/fixtures/context-gather/repo","taskDescription":"add health endpoint"}' --validate-input` exits 0 with ranked file list
- [x] Output contains `files[]` array sorted by `relevanceScore` descending
- [x] Agent does NOT list files in `node_modules`, `dist`, `.factory`, or `.git`
- [x] No network calls in scoring heuristic (deterministic CI)
- [x] Context gather eval passes in `pnpm factory:health`
- [x] `pnpm af agent:validate:all` exits 0
- [x] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify agent structure
test -f services/agents/context-gather/agent.json && echo "PASS: manifest exists" || echo "FAIL: no manifest"
test -f services/agents/context-gather/README.md && echo "PASS: README exists" || echo "FAIL: no README"

# Verify contract types
grep -q "ContextGatherInput" packages/contracts/src/index.ts && echo "PASS: input type exported" || echo "FAIL: no input type"
grep -q "ContextGatherOutput" packages/contracts/src/index.ts && echo "PASS: output type exported" || echo "FAIL: no output type"

# Verify eval fixture
test -d packages/evals/fixtures/context-gather && echo "PASS: fixture dir exists" || echo "FAIL: no fixture dir"

# Run agent
pnpm af agent:run context-gather --input '{"repoRoot":"packages/evals/fixtures/context-gather/repo","taskDescription":"add health endpoint"}' --validate-input

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 11: Task Decomposition Agent

**Objective:** Build an agent that takes a project-level objective and decomposes it into ordered, dependency-aware atomic tasks.

**Prerequisites:** S9 (needs L2 config schema for tech stack awareness)

**Estimated Effort:** 3 hours

**Milestone Definition:**
A new `task-decompose` agent exists at `services/agents/task-decompose/`. The agent accepts a project brief, tech stack info, and optional constraints, then produces an ordered list of atomic tasks with dependency edges, file scopes, and complexity estimates. Tasks are topologically sorted. A `DecomposedTaskList` contract schema is added to `packages/contracts`. Fixture-based evals validate correct dependency ordering and task structure.

**Tasks:**

- [ ] Scaffold `services/agents/task-decompose/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [ ] Define input schema: `{ projectBrief: string, techStack: TechStack, constraints?: string[] }`
- [ ] Define output schema: `{ tasks: DecomposedTask[] }` where `DecomposedTask = { id: string, title: string, description: string, dependsOn: string[], fileScope: string[], estimatedComplexity: "S" | "M" | "L" }`
- [ ] Add contract types to `packages/contracts`: `TaskDecomposeInput`, `DecomposedTaskList`, `DecomposedTask`
- [ ] Implement topological sort on dependency edges — reject circular dependencies with structured error
- [ ] Implement complexity estimation: S = 1 file, M = 2–3 files, L = 4+ files (based on `fileScope` length)
- [ ] Enforce task count limits: minimum 3, maximum 15 tasks per decomposition
- [ ] Enforce task granularity: each task targets 1–3 files (aligned with `repo-patch` defaults)
- [ ] Create eval fixture: `packages/evals/fixtures/task-decompose/` — fixture briefs with known task structures
- [ ] Create eval script: `packages/evals/scripts/eval_task_decompose.js` — asserts ≥3 ordered tasks, no circular dependencies, valid topological sort
- [ ] Add eval to `pnpm factory:health` pipeline
- [ ] Write README documenting decomposition logic, limits, and complexity heuristics

**Acceptance Criteria:**

- [ ] `services/agents/task-decompose/agent.json` exists with valid schemas
- [ ] `pnpm af agent:run task-decompose --input '{"projectBrief":"Add a /health endpoint that returns server status","techStack":{"language":"typescript","framework":"express"}}' --validate-input` exits 0
- [ ] Output contains `tasks[]` array with ≥3 tasks
- [ ] Tasks are in valid topological order (no task appears before its dependencies)
- [ ] No circular dependencies in output (DAG validation)
- [ ] Each task has non-empty `id`, `title`, `description`, `fileScope[]`
- [ ] Task count is between 3 and 15 inclusive
- [ ] Task decompose eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify agent structure
test -f services/agents/task-decompose/agent.json && echo "PASS: manifest exists" || echo "FAIL: no manifest"
test -f services/agents/task-decompose/README.md && echo "PASS: README exists" || echo "FAIL: no README"

# Verify contract types
grep -q "DecomposedTaskList" packages/contracts/src/index.ts && echo "PASS: task list type exported" || echo "FAIL: no task list type"
grep -q "DecomposedTask" packages/contracts/src/index.ts && echo "PASS: task type exported" || echo "FAIL: no task type"

# Run agent with fixture input
pnpm af agent:run task-decompose --input '{"projectBrief":"Add a /health endpoint that returns server status","techStack":{"language":"typescript","framework":"express"}}' --validate-input

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 12: Brief Intake & Clarification Agent

**Objective:** Build an agent that accepts a natural-language project brief, extracts structured requirements, and generates clarifying questions for ambiguous areas.

**Prerequisites:** S9, S11

**Estimated Effort:** 3.5 hours

**Milestone Definition:**
A new `brief-intake` agent exists at `services/agents/brief-intake/`. The agent accepts a natural-language brief and optional user preferences, then produces a structured brief with inferred tech stack, extracted features, constraints, user stories, scope estimate, and clarifying questions. Questions are generated ONLY for Supervised and Human-required decisions per the Autonomy Taxonomy. A fully-specified brief produces 0 questions; an ambiguous brief produces ≥1 question (max 5). Contract schemas for `StructuredBrief` and `ClarificationRequest` are added to `packages/contracts`.

**Tasks:**

- [ ] Scaffold `services/agents/brief-intake/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [ ] Define input schema: `{ brief: string, userPreferences?: object }`
- [ ] Define output schema: `{ structuredBrief: StructuredBrief, clarifyingQuestions: ClarificationRequest[], resolvedAssumptions: string[], scopeEstimate: { sprintCountRange: [number, number], complexityRating: "low" | "medium" | "high" } }`
- [ ] Define `StructuredBrief`: `{ projectName: string, techStack: TechStack, features: string[], constraints: string[], userStories: string[] }`
- [ ] Define `ClarificationRequest`: `{ id: string, question: string, category: "security" | "architecture" | "features" | "ux", impact: "high" | "medium" | "low", defaultAssumption: string }`
- [ ] Add all contract types to `packages/contracts`: `BriefIntakeInput`, `BriefIntakeOutput`, `StructuredBrief`, `ClarificationRequest`
- [ ] Implement question generation: only for Supervised and Human-required decisions; max 5 questions
- [ ] Implement question priority sorting: security > architecture > features > UX
- [ ] Implement scope estimation: sprint count range based on feature count and complexity
- [ ] Create eval fixtures: `packages/evals/fixtures/brief-intake/ambiguous-brief.json` (expects ≥1 question) and `packages/evals/fixtures/brief-intake/complete-brief.json` (expects 0 questions)
- [ ] Create eval script: `packages/evals/scripts/eval_brief_intake.js` — validates structured output, question generation rules, and scope estimate presence
- [ ] Add eval to `pnpm factory:health` pipeline
- [ ] Write README documenting autonomy taxonomy, question categories, and scope estimation

**Acceptance Criteria:**

- [ ] `services/agents/brief-intake/agent.json` exists with valid schemas
- [ ] Agent produces `structuredBrief` with all required fields from a natural-language brief
- [ ] Ambiguous fixture brief produces ≥1 and ≤5 clarifying questions
- [ ] Complete fixture brief produces exactly 0 clarifying questions
- [ ] Questions are sorted by priority: security > architecture > features > UX
- [ ] Each `ClarificationRequest` includes `id`, `question`, `category`, `impact`, `defaultAssumption`
- [ ] `scopeEstimate` is present with `sprintCountRange` and `complexityRating`
- [ ] Brief intake eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify agent structure
test -f services/agents/brief-intake/agent.json && echo "PASS: manifest exists" || echo "FAIL: no manifest"
test -f services/agents/brief-intake/README.md && echo "PASS: README exists" || echo "FAIL: no README"

# Verify contract types
grep -q "StructuredBrief" packages/contracts/src/index.ts && echo "PASS: StructuredBrief exported" || echo "FAIL: no StructuredBrief"
grep -q "ClarificationRequest" packages/contracts/src/index.ts && echo "PASS: ClarificationRequest exported" || echo "FAIL: no ClarificationRequest"

# Verify eval fixtures
test -f packages/evals/fixtures/brief-intake/ambiguous-brief.json && echo "PASS: ambiguous fixture" || echo "FAIL: no ambiguous fixture"
test -f packages/evals/fixtures/brief-intake/complete-brief.json && echo "PASS: complete fixture" || echo "FAIL: no complete fixture"

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 13: Error Recovery Agent

**Objective:** Build an agent that diagnoses pipeline failures and proposes recovery actions.

**Prerequisites:** S8

**Estimated Effort:** 2.5 hours

**Milestone Definition:**
A new `error-recover` agent exists at `services/agents/error-recover/`. The agent accepts a failed agent's ID, result, error output, and attempt count, then produces a diagnosis, recovery action, retry recommendation, and escalation flag. The error classification taxonomy extends the existing Error Taxonomy from `CODEX_STEP_CHAINING_TEMPLATE_v3.md`. Recovery strategies include: retry with modified input, rollback to last good state, skip and flag, and escalate to user. Hard caps: max 3 retries per agent per task, max 10 total retries per pipeline run. Fixture-based evals cover ≥5 distinct error types.

**Tasks:**

- [ ] Scaffold `services/agents/error-recover/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [ ] Define input schema: `{ failedAgentId: string, agentResult: AgentResult, errorOutput: string, attemptCount: number, totalRetries: number }`
- [ ] Define output schema: `{ diagnosis: string, errorClass: ErrorClass, recoveryAction: "retry_modified" | "rollback" | "skip_and_flag" | "escalate", shouldRetry: boolean, escalate: boolean, modifiedInput?: object, rationale: string }`
- [ ] Add contract types to `packages/contracts`: `ErrorRecoverInput`, `ErrorRecoverOutput`, `ErrorClass` (enum extending existing taxonomy)
- [ ] Implement error classification: map error patterns to taxonomy classes (BUILD_ERROR, TEST_FAILURE, SCHEMA_ERROR, MISSING_FILE, PATCH_FAILURE, VALIDATION_FAILURE, BUDGET_EXCEEDED, DEPENDENCY_FAILED, MAX_RETRIES)
- [ ] Implement recovery strategy selection: recoverable errors → retry; non-recoverable → escalate
- [ ] Implement retry cap enforcement: `shouldRetry = false` when `attemptCount >= 3` or `totalRetries >= 10`
- [ ] Create eval fixtures: `packages/evals/fixtures/error-recover/` — at least 5 distinct failure scenarios (build error, test failure, patch failure, budget exceeded, max retries hit)
- [ ] Create eval script: `packages/evals/scripts/eval_error_recover.js` — validates correct classification, recovery action, and cap enforcement for each fixture
- [ ] Add eval to `pnpm factory:health` pipeline
- [ ] Write README documenting error taxonomy, recovery strategies, and retry caps

**Acceptance Criteria:**

- [ ] `services/agents/error-recover/agent.json` exists with valid schemas
- [ ] Agent correctly classifies ≥5 distinct error types from fixture inputs
- [ ] Agent proposes `retry_modified` for recoverable errors (BUILD_ERROR, TEST_FAILURE, SCHEMA_ERROR, MISSING_FILE)
- [ ] Agent proposes `escalate` for non-recoverable errors (BUDGET_EXCEEDED, MAX_RETRIES)
- [ ] Agent returns `shouldRetry: false` when `attemptCount >= 3`
- [ ] Agent returns `shouldRetry: false` when `totalRetries >= 10`
- [ ] Error recover eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify agent structure
test -f services/agents/error-recover/agent.json && echo "PASS: manifest exists" || echo "FAIL: no manifest"
test -f services/agents/error-recover/README.md && echo "PASS: README exists" || echo "FAIL: no README"

# Verify contract types
grep -q "ErrorRecoverInput" packages/contracts/src/index.ts && echo "PASS: input type exported" || echo "FAIL: no input type"
grep -q "ErrorRecoverOutput" packages/contracts/src/index.ts && echo "PASS: output type exported" || echo "FAIL: no output type"

# Verify eval fixtures (at least 5)
fixture_count=$(ls packages/evals/fixtures/error-recover/*.json 2>/dev/null | wc -l)
if [ "$fixture_count" -ge 5 ]; then echo "PASS: $fixture_count fixtures"; else echo "FAIL: only $fixture_count fixtures (need ≥5)"; fi

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 14: Orchestrator Agent — Single-Task Pipeline

**Objective:** Build an orchestrator that chains existing pipeline agents for a single atomic task without human intervention.

**Prerequisites:** S10 (context-gather), S13 (error-recover)

**Estimated Effort:** 4 hours

**Milestone Definition:**
A new `orchestrator` agent exists at `services/agents/orchestrator/`. The agent accepts a single task, L2 config, and repo root, then chains the pipeline: `context-gather → plan → repo-patch → validate → git-pr`. Each stage's output feeds the next stage's input via contract-mediated handoffs. On stage failure, the orchestrator consults the `error-recover` agent before proceeding. All intermediate results are written to `.factory/runs/<correlationId>/`. Token budget tracking logs cumulative usage per stage. A fixture-based eval tests end-to-end execution with a trivial task.

**Tasks:**

- [ ] Scaffold `services/agents/orchestrator/` with `agent.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- [ ] Define input schema: `{ task: DecomposedTask, l2Config: Layer2Config, repoRoot: string, tokenBudget?: number }`
- [ ] Define output schema: `{ pipelineResult: { ok: boolean, completedStages: string[], failedStage?: string }, stageResults: StageResult[], artifactPaths: string[], tokenUsage: { perStage: Record<string, number>, total: number } }`
- [ ] Add contract types to `packages/contracts`: `OrchestratorInput`, `OrchestratorOutput`, `StageResult`, `PipelineResult`
- [ ] Implement stage chain: `context-gather → plan → repo-patch → validate → git-pr`
- [ ] Implement inter-stage contract validation: validate each stage's output against schema before passing to next stage
- [ ] Implement error recovery integration: on stage failure, invoke `error-recover` agent, follow its recommendation (retry/rollback/skip/escalate)
- [ ] Implement artifact logging: write all intermediate results to `.factory/runs/<correlationId>/`
- [ ] Implement token budget tracking: cumulative count per stage, halt on budget exhaustion
- [ ] Create eval fixture: `packages/evals/fixtures/orchestrator/` — trivial task (e.g., add a comment to a fixture file) with L2 config
- [ ] Create eval script: `packages/evals/scripts/eval_orchestrator_single.js` — asserts pipeline completes with all stages logged, artifact directory structure is correct
- [ ] Create eval for error recovery path: fixture that triggers a validation failure, assert recovery agent is consulted
- [ ] Add evals to `pnpm factory:health` pipeline
- [ ] Write README documenting pipeline chain, error recovery integration, artifact structure, and token tracking

**Acceptance Criteria:**

- [ ] `services/agents/orchestrator/agent.json` exists with valid schemas
- [ ] Orchestrator chains all 5 stages for a fixture task and produces `ok: true`
- [ ] Artifact directory `.factory/runs/<correlationId>/` contains expected files (task.json, plan.json, result.json)
- [ ] `stageResults[]` contains entries for each completed stage
- [ ] `tokenUsage` object is populated with per-stage and total counts
- [ ] On deliberate validation failure, orchestrator consults `error-recover` agent
- [ ] Retry caps from `AGENTS.md` are respected (max 3 per agent, max 10 total)
- [ ] Orchestrator eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify agent structure
test -f services/agents/orchestrator/agent.json && echo "PASS: manifest exists" || echo "FAIL: no manifest"
test -f services/agents/orchestrator/README.md && echo "PASS: README exists" || echo "FAIL: no README"

# Verify contract types
grep -q "OrchestratorInput" packages/contracts/src/index.ts && echo "PASS: input type exported" || echo "FAIL: no input type"
grep -q "OrchestratorOutput" packages/contracts/src/index.ts && echo "PASS: output type exported" || echo "FAIL: no output type"
grep -q "StageResult" packages/contracts/src/index.ts && echo "PASS: StageResult exported" || echo "FAIL: no StageResult"

# Verify eval fixtures
test -d packages/evals/fixtures/orchestrator && echo "PASS: fixture dir exists" || echo "FAIL: no fixture dir"

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 15: Orchestrator Agent — Multi-Task Pipeline

**Objective:** Extend the orchestrator to execute a full decomposed task list with dependency ordering.

**Prerequisites:** S11 (task-decompose), S14 (single-task orchestrator)

**Estimated Effort:** 3.5 hours

**Milestone Definition:**
The orchestrator agent is extended with a multi-task execution mode. It accepts a `DecomposedTaskList` (from `task-decompose`), executes tasks in topological dependency order, propagates failures to downstream dependents, emits structured progress events per-task, and produces a cumulative artifact directory. Independent tasks execute sequentially (no parallelism in MVP). A fixture-based eval tests a 3-task list with correct ordering and failure propagation.

**Tasks:**

- [ ] Extend `services/agents/orchestrator/src/index.ts` with multi-task execution path
- [ ] Extend input schema to accept: `{ taskList: DecomposedTaskList, l2Config: Layer2Config, repoRoot: string, tokenBudget?: number }` (in addition to existing single-task mode)
- [ ] Extend output schema: `{ overallResult: { ok: boolean, completedTasks: string[], failedTasks: string[], skippedTasks: string[] }, taskResults: TaskPipelineResult[], artifactPaths: string[] }`
- [ ] Add contract types to `packages/contracts`: `MultiTaskOrchestratorInput`, `MultiTaskOrchestratorOutput`, `TaskPipelineResult`
- [ ] Implement topological execution: resolve dependency order, execute tasks sequentially
- [ ] Implement failure propagation: if a task fails and is a dependency of others, mark downstream tasks as `SKIPPED`
- [ ] Implement progress reporting: emit one structured progress JSON event per task start/complete/fail/skip to `progress.jsonl`
- [ ] Implement cumulative artifact directory: `.factory/runs/<pipelineId>/tasks/<taskId>/`
- [ ] Enforce task cap: max 15 tasks per pipeline run (from `AGENTS.md` invariants)
- [ ] Create eval fixture: `packages/evals/fixtures/orchestrator-multi/` — 3 tasks (2 independent + 1 dependent on task 1)
- [ ] Create eval script: `packages/evals/scripts/eval_orchestrator_multi.js` — asserts correct execution order, failure propagation (when task 1 fails, task 3 is skipped, task 2 still executes)
- [ ] Add eval to `pnpm factory:health` pipeline
- [ ] Update orchestrator README with multi-task documentation

**Acceptance Criteria:**

- [ ] Orchestrator accepts a `DecomposedTaskList` input and executes tasks in dependency order
- [ ] Independent tasks (no dependencies on each other) both execute regardless of each other's status
- [ ] When a task fails, all dependent downstream tasks are marked `SKIPPED` with reason
- [ ] `progress.jsonl` contains one event per task state change (started, completed, failed, skipped)
- [ ] Artifact directory follows structure: `.factory/runs/<pipelineId>/tasks/<taskId>/`
- [ ] Task cap of 15 is enforced (agent returns `ok: false` if exceeded)
- [ ] Multi-task orchestrator eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `packages/contracts` `check:breaking` passes

**Acceptance Commands:**

```bash
# Verify extended contract types
grep -q "MultiTaskOrchestratorInput" packages/contracts/src/index.ts && echo "PASS: multi-task input exported" || echo "FAIL: no multi-task input"
grep -q "TaskPipelineResult" packages/contracts/src/index.ts && echo "PASS: TaskPipelineResult exported" || echo "FAIL: no TaskPipelineResult"

# Verify eval fixtures
test -d packages/evals/fixtures/orchestrator-multi && echo "PASS: multi-task fixture dir exists" || echo "FAIL: no fixture dir"

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 16: End-to-End Integration — Brief to Build Plan

**Objective:** Wire the complete Phase 3 pipeline: brief → clarification → decomposition → orchestrated execution for a trivial project.

**Prerequisites:** S12 (brief-intake), S15 (multi-task orchestrator)

**Estimated Effort:** 4 hours

**Milestone Definition:**
A new CLI command `pnpm af pipeline:run --brief '<text>' --l2-config <path>` accepts a natural-language brief and Layer 2 config, wires the full pipeline (`brief-intake → [clarification pause] → task-decompose → orchestrator`), and executes at least the plan stage end-to-end. The clarification pause point halts the pipeline when questions are generated and resumes after user answers. An end-to-end fixture test uses a trivial brief ("Add a `/health` endpoint") to validate the full flow. `AGENTS.md` is updated with Phase 3 invariants. `packages/evals` includes the Phase 3 eval suite.

**Tasks:**

- [ ] Add `pipeline:run` command to `packages/factory` CLI: `pnpm af pipeline:run --brief '<text>' --l2-config <path> [--answers '<json>']`
- [ ] Implement pipeline wiring: `brief-intake → task-decompose → orchestrator`
- [ ] Implement clarification pause: if `brief-intake` produces `clarifyingQuestions.length > 0`, output questions as JSON and exit with code 0 and `{ status: "AWAITING_CLARIFICATION", questions: [...] }`
- [ ] Implement resume: `--answers '<json>'` flag provides answers to clarifying questions, pipeline resumes from `task-decompose`
- [ ] Create end-to-end fixture test: brief = "Add a /health endpoint that returns server status", L2 config = `docs/examples/nextjs-micro-saas.json`
- [ ] Create eval script: `packages/evals/scripts/eval_pipeline_e2e.js` — runs `pipeline:run` with fixture brief, asserts structured plan is produced and at least the plan stage completes
- [ ] Add eval to `pnpm factory:health` pipeline
- [ ] Update `AGENTS.md` with Phase 3 invariants (orchestrator caps, pipeline CLI contract, clarification protocol) — version bump to v3
- [ ] Update `README.md` Pipeline section with `pipeline:run` usage
- [ ] Verify all cross-references in updated docs resolve

**Acceptance Criteria:**

- [ ] `pnpm af pipeline:run --brief 'Add a /health endpoint' --l2-config docs/examples/nextjs-micro-saas.json` exits 0 with structured output
- [ ] Output includes a structured plan (task list with dependency ordering)
- [ ] At least the plan stage executes end-to-end
- [ ] Clarification flow works: ambiguous brief triggers pause, answers resume pipeline
- [ ] `AGENTS.md` contains `## Orchestrator Invariants (Phase 3)` section
- [ ] `AGENTS.md` contains `## Autonomy Taxonomy (Phase 3)` section
- [ ] `AGENTS.md` version header updated to v3
- [ ] Pipeline e2e eval passes in `pnpm factory:health`
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `pnpm factory:health` passes with Phase 3 evals included

**Acceptance Commands:**

```bash
# Verify pipeline command exists
pnpm af pipeline:run --help 2>&1 | grep -q "pipeline" && echo "PASS: pipeline command exists" || echo "FAIL: no pipeline command"

# Run pipeline with fixture brief
pnpm af pipeline:run --brief 'Add a /health endpoint that returns server status' --l2-config docs/examples/nextjs-micro-saas.json

# Verify AGENTS.md Phase 3 sections
grep -q "## Orchestrator Invariants" AGENTS.md && echo "PASS: orchestrator invariants" || echo "FAIL: missing orchestrator invariants"
grep -q "## Autonomy Taxonomy" AGENTS.md && echo "PASS: autonomy taxonomy" || echo "FAIL: missing autonomy taxonomy"
grep -q "VERSION: v3" AGENTS.md && echo "PASS: v3 header" || echo "FAIL: no v3 header"

# Verify all agents
pnpm af agent:validate:all

# Verify contracts
pnpm -C packages/contracts check:breaking

# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health

echo "=== PHASE 3 VALIDATION COMPLETE ==="
```

---

## Sprint Log

| Sprint | Milestone | Description                                  | Gate |
| ------ | --------- | -------------------------------------------- | ---- |
| 9      | S9        | Machine-Readable Layer 2 Configs             | PASS |
| 10     | S10       | Context Gathering Agent                      | PASS |
| 11     | S11       | Task Decomposition Agent                     |      |
| 12     | S12       | Brief Intake & Clarification Agent           |      |
| 13     | S13       | Error Recovery Agent                         |      |
| 14     | S14       | Orchestrator Agent — Single-Task Pipeline    |      |
| 15     | S15       | Orchestrator Agent — Multi-Task Pipeline     |      |
| 16     | S16       | End-to-End Integration — Brief to Build Plan |      |

---

## Summary

**Phase 3 Sprints:** 8 (S9–S16)
**Estimated Total Effort:** 26.5 hours (~4–5 days focused work)
**New Agents:** 6 (l2-config-validate, context-gather, task-decompose, brief-intake, error-recover, orchestrator)
**New Contract Schemas:** ~15 types
**Milestone IDs:** S9, S10, S11, S12, S13, S14, S15, S16

### Sprint Dependency Graph

```
S8 (Phase 2 Complete)
 │
 ├── S9 (L2 Configs) ──┬── S11 (Task Decompose) ── S12 (Brief Intake) ──┐
 │                      │                                                 │
 ├── S10 (Context Gather) ──┐                                            │
 │                          ├── S14 (Orchestrator Single) ──┐            │
 ├── S13 (Error Recover) ───┘                               │            │
 │                                                          │            │
 │                      S11 ── S15 (Orchestrator Multi) ────┘            │
 │                              │                                        │
 │                              └── S15 requires S11 + S14               │
 │                                                                       │
 └── S16 (E2E Integration) requires S12 + S15 ──────────────────────────┘
```

### Critical Path

```
S9 → S11 → S12 ─┐
                 ├→ S16 (E2E Integration)
S10 → S14 → S15 ┘
S13 → S14
```

**Longest path:** S9 → S11 → S12 → S16 (4 sprints)
**Parallelizable:** S10 and S13 can start immediately after S8 (no dependency on S9)
