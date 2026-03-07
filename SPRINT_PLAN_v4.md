<!-- LAST_UPDATED: 2026-03-01 -->

# Agent Factory Phase 4 — Full-Stack Code Generation — Sprint Plan (Single Source of Truth)

> **Purpose:** Enable the factory to generate complete working applications from structured build plans.
> **Phase 4 Goal:** Given a Next.js micro-SaaS build plan, the factory produces a compilable, runnable application with React components, API routes, Drizzle ORM schemas, Auth.js config, and Stripe webhook handlers — all driven by the Phase 3 control plane.
> **Exit Criteria:**
>
> - Given a Next.js micro-SaaS build plan, the factory produces a compilable, runnable application
> - Generated code passes `tsc` type checking and `next build`
> - All generated files conform to the project's Layer 2 constraints
> - The factory handles at least: React components, API routes, Drizzle ORM schemas, Auth.js config, and Stripe webhook handlers
> - Task classification is operationally meaningful across generation types
>
> **Risk Level:** High — code generation quality is the single biggest determinant of factory value. Non-deterministic LLM output requires robust validation loops.
>
> **Phase 4 Implementation Rule:** This phase introduces generation capability, not a second orchestration system. All failures route through S13's recovery contract. All events use S14's event schema. All decisions use S14's decision-log interface.
>
> If work isn't captured here, it's scope creep.

---

## Status Legend

- [x] Done (implemented + verified passing)
- [~] In progress (partially implemented, not fully verified)
- [ ] Not started

---

## Phase 3 Completion Summary

| Sprint | Milestone | Description                                         | Gate |
| ------ | --------- | --------------------------------------------------- | ---- |
| 1      | S1        | Contracts package setup                             | PASS |
| 2      | S2        | Agent runtime shared helpers                        | PASS |
| 3      | S3        | Agent runner manifest-driven loader                 | PASS |
| 4      | S4        | Factory CLI scaffolding                             | PASS |
| 5      | S5        | Evals package + health checks                       | PASS |
| 6      | S6        | Smoke agent (hello-world)                           | PASS |
| 7      | S7        | Repo-patch agent                                    | PASS |
| 8      | S8        | Layer 2 documentation templates                     | PASS |
| 9      | S9        | Machine-readable Layer 2 configs + validation agent | PASS |
| 10     | S10       | Plan agent                                          | PASS |
| 11     | S11       | Cross-cutting principles + contract governance docs | PASS |
| 12     | S12       | Context-gather agent                                | PASS |
| 13     | S13       | Error-recover agent                                 | PASS |
| 14     | S14       | Orchestrator agent                                  | PASS |
| 15     | S15       | Task-decompose agent + brief-intake agent           | PASS |
| 16     | S16       | End-to-end pipeline integration + golden fixtures   | PASS |

**Phase 3 baseline:** The factory has a fully operational autonomous pipeline: brief intake → task decomposition → context gathering → planning → repo-patch → validation → error recovery → orchestration. All agents communicate via validated contracts. The orchestrator chains agents with retry/recovery caps, event logging, and decision-log support. Golden fixtures provide regression safety. CLI supports `pnpm af pipeline:run`. The governance/runtime control-plane split is documented.

---

## Sprint 17 (S17): Code Generation Agent — Greenfield Files

**Objective:** Build an agent that generates complete new files from a specification, complementing `repo-patch` (which modifies existing files).

**Prerequisites:** S16 (Phase 3 complete)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create a new `code-gen` agent at `services/agents/code-gen/` that accepts a file specification and produces one or more generated files. The agent supports multi-file output, enforces file scope constraints, detects language from file extension, and introduces the `FileSpec` and `GeneratedFile` contract types. Failures emit `RuntimeEvent` via S14. Recovery uses `RecoveryStrategy` from S13. The agent does NOT create new retry or event mechanisms.

**Tasks:**

- [x] Create `services/agents/code-gen/agent.json` with `inputSchema` and `outputSchema`
- [x] Create `services/agents/code-gen/src/index.ts` implementing `run(input)` → `AgentResult`
- [x] Create `services/agents/code-gen/package.json` with workspace deps (`@acme/agent-runtime`, `@acme/contracts`)
- [x] Create `services/agents/code-gen/tsconfig.json` extending workspace base
- [x] Create `services/agents/code-gen/README.md` with purpose, I/O contract, safety constraints, usage examples
- [x] Add `FileSpec` type to `packages/contracts` (path, purpose, techStack, templateHints?, dependencies?)
- [x] Add `GeneratedFile` type to `packages/contracts` (path, content, language)
- [x] Create eval fixture: fixture spec → generated TypeScript file → validate with `tsc --noEmit`
- [x] Add eval fixture(s) to `packages/evals/fixtures/`
- [x] Verify exact export names from `packages/contracts`: `RuntimeEvent` (S14), `RecoveryStrategy` (S13) — if names differ, use actual names throughout S17–S24
- [x] Verify failures emit `RuntimeEvent` (S14 schema)
- [x] Verify recovery uses `RecoveryStrategy` (S13 schema)
- [x] Run `pnpm install` to regenerate lockfile after adding new package

**Acceptance Criteria:**

- [x] `pnpm af agent:validate code-gen` exits 0
- [x] `pnpm af agent:run code-gen --input '<fixture>' --validate-input` exits 0 and produces valid `GeneratedFile[]` output
- [x] `FileSpec` and `GeneratedFile` types exported from `packages/contracts`
- [x] Exact export names verified: `RuntimeEvent` (S14) and `RecoveryStrategy` (S13) confirmed from `packages/contracts` source — if different, actual names used
- [x] `pnpm -C packages/contracts check:breaking` exits 0 (additive only)
- [x] Eval fixture passes: generated `.ts` file compiles via `tsc --noEmit`
- [x] Multi-file output works (fixture with 2+ files)
- [x] File scope enforcement: agent returns `ok: false` for paths outside `outputDir`
- [x] Language detection matches file extension
- [x] No parallel retry/event/state systems created
- [x] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate code-gen
pnpm af agent:run code-gen --input '{"fileSpec":{"path":"src/utils/helpers.ts","purpose":"utility functions","techStack":{"language":"typescript","framework":"node"}}}' --validate-input
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy)
> - Must NOT create: parallel retry mechanism, parallel event system, parallel state management
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem), #6 (Contract validation ownership)

---

## Sprint 18 (S18): Project Scaffold Agent

**Objective:** Generate the initial project skeleton from a Layer 2 config — directory structure, `package.json`, `tsconfig`, and base configuration files.

**Prerequisites:** S9 (Layer 2 configs), S17 (code-gen agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create a `project-scaffold` agent at `services/agents/project-scaffold/` that takes a Layer 2 configuration and an output directory, then generates the complete initial file structure for a project. The L2 config drives all scaffold decisions: language, framework, database, ORM. Scaffold artifacts must be compatible with Phase 3 event/decision logging. The agent reuses Phase 3 contracts and does NOT create scaffold-specific state management.

**Tasks:**

- [x] Create `services/agents/project-scaffold/agent.json` with `inputSchema` and `outputSchema`
- [x] Create `services/agents/project-scaffold/src/index.ts` implementing `run(input)` → `AgentResult`
- [x] Create `services/agents/project-scaffold/package.json` with workspace deps
- [x] Create `services/agents/project-scaffold/tsconfig.json` extending workspace base
- [x] Create `services/agents/project-scaffold/README.md`
- [x] L2 config drives scaffold decisions (language, framework, database, ORM)
- [x] Output includes: directory structure, `package.json`, `tsconfig.json`, base config files
- [x] Create eval fixture: scaffold from Next.js L2 config → verify `pnpm install` + `tsc --noEmit`
- [x] Add eval fixture(s) to `packages/evals/fixtures/`
- [x] Verify scaffold artifacts compatible with Phase 3 event/decision logging
- [x] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [x] `pnpm af agent:validate project-scaffold` exits 0
- [x] `pnpm af agent:run project-scaffold --input '<fixture>' --validate-input` exits 0 and produces valid `scaffoldedFiles[]`
- [x] Scaffold output includes `package.json`, `tsconfig.json`, and at least one config file
- [x] L2 config `techStack` fields drive scaffold output (Next.js L2 → Next.js project)
- [x] Eval fixture passes: scaffolded project passes `pnpm install` + `tsc --noEmit`
- [x] `pnpm -C packages/contracts check:breaking` exits 0
- [x] No scaffold-specific state management created
- [x] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate project-scaffold
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy, L2 config types)
> - Must NOT create: scaffold-specific state management, parallel event system
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem), #5 (One governance/runtime control-plane split)

---

## Sprint 19 (S19): Database Schema & Migration Agent

**Objective:** Generate database schemas (ORM models) and migration files from a data model specification.

**Prerequisites:** S17 (code-gen agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create a `db-schema` agent at `services/agents/db-schema/` that accepts a data model specification (entities, relationships) and tech stack (database, ORM) and generates schema files, migration files, and optionally a seed file. Supports Drizzle ORM (primary) and Prisma (secondary). Handles one-to-many, many-to-many, and self-referential relationships. Failures route through S13 recovery. No ORM-specific retry logic.

**Tasks:**

- [x] Create `services/agents/db-schema/agent.json` with `inputSchema` and `outputSchema`
- [x] Create `services/agents/db-schema/src/index.ts` implementing `run(input)` → `AgentResult`
- [x] Create `services/agents/db-schema/package.json` with workspace deps
- [x] Create `services/agents/db-schema/tsconfig.json` extending workspace base
- [x] Create `services/agents/db-schema/README.md`
- [x] Support Drizzle ORM (primary) and Prisma (secondary) output formats
- [x] Support PostgreSQL and SQLite database targets
- [x] Handle relationships: one-to-many, many-to-many, self-referential
- [x] Output: `schemaFiles[]`, `migrationFiles[]`, `seedFile?`
- [x] Create eval fixture: fixture data model → Drizzle schema → validate TypeScript compiles
- [x] Add eval fixture(s) to `packages/evals/fixtures/`
- [x] Verify failures route through S13 `RecoveryStrategy`
- [x] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [x] `pnpm af agent:validate db-schema` exits 0
- [x] `pnpm af agent:run db-schema --input '<fixture>' --validate-input` exits 0 and produces valid `schemaFiles[]`
- [x] Drizzle ORM output: generated schema compiles (`tsc --noEmit`)
- [x] Relationship types handled: one-to-many, many-to-many, self-referential
- [x] Eval fixture passes: data model → Drizzle schema → TypeScript compiles
- [x] `pnpm -C packages/contracts check:breaking` exits 0
- [x] No ORM-specific retry logic created
- [x] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate db-schema
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy)
> - Must NOT create: ORM-specific retry logic, parallel event system
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem)

---

## Sprint 20 (S20): API Route Generation Agent

**Objective:** Generate backend API routes (REST or tRPC) from a route specification.

**Prerequisites:** S17 (code-gen agent), S19 (db-schema agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create an `api-gen` agent at `services/agents/api-gen/` that accepts a route specification (methods, paths, purposes, schemas, auth requirements) and tech stack, then generates route handler files and optional middleware. Supports Next.js App Router route handlers and Express-style handlers. Includes Zod input validation, error handling, and typed responses. Auth-aware routes include session validation. API tasks receive partitioned context (route spec, schema references, auth requirements) — not the whole project narrative.

**Tasks:**

- [x] Create `services/agents/api-gen/agent.json` with `inputSchema` and `outputSchema`
- [x] Create `services/agents/api-gen/src/index.ts` implementing `run(input)` → `AgentResult`
- [x] Create `services/agents/api-gen/package.json` with workspace deps
- [x] Create `services/agents/api-gen/tsconfig.json` extending workspace base
- [x] Create `services/agents/api-gen/README.md`
- [x] Support Next.js App Router route handlers (primary) and Express-style (secondary)
- [x] Include Zod input validation in generated routes
- [x] Include typed error handling and responses
- [x] Auth-aware: `auth: true` routes include session validation scaffolding
- [x] Context partitioning: agent receives route spec + schema references + auth requirements only
- [x] Verify eval strategy for Next.js types: either include `next` as devDependency in eval tsconfig, or validate generated code structurally without full Next.js type resolution. Document chosen approach in README.
- [x] Create eval fixture: fixture route spec → Next.js route handler → validate compiles
- [x] Add eval fixture(s) to `packages/evals/fixtures/`
- [x] Verify failures use S13 recovery
- [x] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [x] `pnpm af agent:validate api-gen` exits 0
- [x] `pnpm af agent:run api-gen --input '<fixture>' --validate-input` exits 0 and produces valid `routeFiles[]`
- [x] Generated Next.js route handler compiles (`tsc --noEmit`)
- [x] Auth-aware routes include session validation code
- [x] Zod validation present in generated route handlers
- [x] Eval fixture passes: route spec → handler → TypeScript compiles
- [x] Eval strategy for Next.js types documented in README (full types or structural validation)
- [x] `pnpm -C packages/contracts check:breaking` exits 0
- [x] No route-specific orchestration created
- [x] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate api-gen
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy)
> - Must NOT create: route-specific orchestration, parallel retry mechanism
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem)

---

## Sprint 21 (S21): Frontend Component Generation Agent

**Objective:** Generate React/Next.js UI components from a component specification.

**Prerequisites:** S17 (code-gen agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create a `ui-gen` agent at `services/agents/ui-gen/` that accepts a component specification (names, purposes, props, data sources, interactions) and a design system reference, then generates React/Next.js component files and optional page files. Default styling uses shadcn/ui + Tailwind CSS (overridable via L2 config). Generated components must meet WCAG 2.1 AA compliance: semantic HTML, ARIA labels, keyboard navigation. Responsive design uses mobile-first Tailwind breakpoints. Accessibility output becomes a first-class quality input for Phase 5's code review.

**Tasks:**

- [ ] Create `services/agents/ui-gen/agent.json` with `inputSchema` and `outputSchema`
- [ ] Create `services/agents/ui-gen/src/index.ts` implementing `run(input)` → `AgentResult`
- [ ] Create `services/agents/ui-gen/package.json` with workspace deps
- [ ] Create `services/agents/ui-gen/tsconfig.json` extending workspace base
- [ ] Create `services/agents/ui-gen/README.md`
- [ ] Default design system: shadcn/ui + Tailwind CSS (overridable via L2 config)
- [ ] WCAG 2.1 AA compliance: semantic HTML, ARIA labels, keyboard navigation
- [ ] Responsive: mobile-first with Tailwind breakpoints
- [ ] Output: `componentFiles[]`, `pageFiles?`
- [ ] Create eval fixture: fixture spec → `.tsx` → validate compiles + accessibility attributes present
- [ ] Add eval fixture(s) to `packages/evals/fixtures/`
- [ ] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [ ] `pnpm af agent:validate ui-gen` exits 0
- [ ] `pnpm af agent:run ui-gen --input '<fixture>' --validate-input` exits 0 and produces valid `componentFiles[]`
- [ ] Generated `.tsx` files compile (`tsc --noEmit`)
- [ ] Generated components contain ARIA attributes (eval assertion)
- [ ] Generated components use semantic HTML elements (eval assertion)
- [ ] Eval fixture passes: component spec → `.tsx` → compiles + a11y attributes present
- [ ] `pnpm -C packages/contracts check:breaking` exits 0
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate ui-gen
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy)
> - Must NOT create: UI-specific retry mechanism, parallel event system
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem)

---

## Sprint 22 (S22): Authentication Scaffold Agent

**Objective:** Generate authentication configuration and flows. Auth is security-critical — this is a Human-required decision point.

**Prerequisites:** S20 (api-gen agent), S21 (ui-gen agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create an `auth-scaffold` agent at `services/agents/auth-scaffold/` that generates authentication configuration, route files, middleware, and optional UI components. Supports Auth.js/NextAuth (primary) and custom JWT (secondary). Providers: Google, GitHub, email/password. Auth strategy and provider selection are Human-required decisions logged via the S14 `DecisionLogEntry` interface. Implementation details are Full autonomy. All supervised/human-required decisions feed delivery summaries in Phase 6.

**Tasks:**

- [ ] Create `services/agents/auth-scaffold/agent.json` with `inputSchema` and `outputSchema`
- [ ] Create `services/agents/auth-scaffold/src/index.ts` implementing `run(input)` → `AgentResult`
- [ ] Create `services/agents/auth-scaffold/package.json` with workspace deps
- [ ] Create `services/agents/auth-scaffold/tsconfig.json` extending workspace base
- [ ] Create `services/agents/auth-scaffold/README.md`
- [ ] Support Auth.js/NextAuth (primary) and custom JWT (secondary)
- [ ] Support providers: Google, GitHub, email/password
- [ ] Generate: auth config, session middleware, login/signup pages, protected route wrapper
- [ ] Output: `configFiles[]`, `routeFiles[]`, `middlewareFiles[]`, `componentFiles?`
- [ ] Log Human-required decisions (auth strategy, provider selection) via S14 `DecisionLogEntry`
- [ ] Verify `DecisionLogEntry` exact type name and level enum values from `packages/contracts` source — use actual enum casing (e.g., `human_required` vs `HUMAN_REQUIRED`). Document verified values in README for S23 to reuse.
- [ ] Create eval fixture: fixture spec → Auth.js config → validate TypeScript compiles
- [ ] Add eval fixture(s) to `packages/evals/fixtures/`
- [ ] Verify decision-log entries emit correctly
- [ ] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [ ] `pnpm af agent:validate auth-scaffold` exits 0
- [ ] `pnpm af agent:run auth-scaffold --input '<fixture>' --validate-input` exits 0 and produces valid output
- [ ] Generated Auth.js config compiles (`tsc --noEmit`)
- [ ] Auth strategy logged as `DecisionLogEntry` with level matching S14 enum for human-required decisions
- [ ] Provider selection logged as `DecisionLogEntry` with level matching S14 enum for human-required decisions
- [ ] `DecisionLogEntry` level enum values verified from `packages/contracts` source and documented in README
- [ ] Eval fixture passes: auth spec → Auth.js config → TypeScript compiles
- [ ] `pnpm -C packages/contracts check:breaking` exits 0
- [ ] No auth-specific decision system created (uses S14 shared interface)
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate auth-scaffold
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy, DecisionLogEntry)
> - Must NOT create: auth-specific decision system, parallel retry mechanism
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem), #3 (One review-ready state model — decisions logged consistently)

---

## Sprint 23 (S23): Payments Integration Agent

**Objective:** Generate Stripe payment integration including webhook handlers, checkout flows, and subscription management.

**Prerequisites:** S20 (api-gen agent), S22 (auth-scaffold agent)

**Estimated Effort:** 6–8 hours

**Milestone Definition:**
Create a `payments-gen` agent at `services/agents/payments-gen/` that generates Stripe payment integration code including webhook handlers, checkout flows, billing components, and configuration. Supports one-time payments, subscriptions, and usage-based billing. Stripe-specific: webhook signature verification, idempotency keys, error handling. Payment model architecture is Human-required; webhook event selection is Supervised. All decisions logged via S14 `DecisionLogEntry`. Decision entries feed delivery summaries in Phase 6.

**Tasks:**

- [ ] Create `services/agents/payments-gen/agent.json` with `inputSchema` and `outputSchema`
- [ ] Create `services/agents/payments-gen/src/index.ts` implementing `run(input)` → `AgentResult`
- [ ] Create `services/agents/payments-gen/package.json` with workspace deps
- [ ] Create `services/agents/payments-gen/tsconfig.json` extending workspace base
- [ ] Create `services/agents/payments-gen/README.md`
- [ ] Support payment models: one-time, subscriptions, usage-based billing
- [ ] Stripe-specific: webhook signature verification, idempotency keys, error handling
- [ ] Output: `webhookHandlers[]`, `checkoutFiles[]`, `billingComponents?`, `configFiles[]`
- [ ] Log Human-required decisions (payment model architecture) via S14 `DecisionLogEntry`
- [ ] Log Supervised decisions (webhook event selection) via S14 `DecisionLogEntry`
- [ ] Create eval fixture: fixture spec → webhook handler → validate compiles + includes signature verification
- [ ] Add eval fixture(s) to `packages/evals/fixtures/`
- [ ] Verify decision-log entries emit correctly
- [ ] Run `pnpm install` to regenerate lockfile

**Acceptance Criteria:**

- [ ] `pnpm af agent:validate payments-gen` exits 0
- [ ] `pnpm af agent:run payments-gen --input '<fixture>' --validate-input` exits 0 and produces valid output
- [ ] Generated webhook handler compiles (`tsc --noEmit`)
- [ ] Generated webhook handler includes Stripe signature verification (eval assertion)
- [ ] Payment model architecture logged as `DecisionLogEntry` with level `human_required`
- [ ] Webhook event selection logged as `DecisionLogEntry` with level `supervised`
- [ ] Eval fixture passes: payment spec → webhook handler → compiles + signature verification present
- [ ] `pnpm -C packages/contracts check:breaking` exits 0
- [ ] No payment-specific decision or retry system created
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af agent:validate payments-gen
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: `@acme/agent-runtime`, `@acme/contracts` (RuntimeEvent, RecoveryStrategy, DecisionLogEntry)
> - Must NOT create: payment-specific decision system, parallel retry mechanism, payment-specific event model
> - Applicable principles: #1 (One event model), #2 (One retry/recovery subsystem), #3 (One review-ready state model)

---

## Sprint 24 (S24): Full-Stack Integration Test — Next.js Micro-SaaS

**Objective:** Wire all Phase 4 agents into the orchestrator and validate the complete generation chain.

**Prerequisites:** S17–S23 (all Phase 4 agents)

**Estimated Effort:** 8–12 hours

**Milestone Definition:**
Wire the full-stack generation pipeline through the Phase 3 orchestrator: `project-scaffold → db-schema → api-gen → ui-gen → auth-scaffold → payments-gen`. Create an end-to-end integration test that takes a Next.js micro-SaaS Layer 2 config and produces a complete, compilable project. Operationalize the S15 `TaskClassification` schema with concrete generation types. Extend the S16 golden fixture set with task classification entries and decision-log samples. Run regression against all S16 fixtures to verify no contract drift. Add Phase 4 invariants to `AGENTS.md`.

**Tasks:**

- [ ] **Prerequisite check:** Verify `run:golden-fixtures` script exists in `packages/evals/package.json` — if missing, create it as part of this sprint
- [ ] **Prerequisite check:** Verify S15 `TaskClassification` schema supports extension (open discriminated union) — if closed enum, convert to open union as an additive change before adding Phase 4 types
- [ ] Wire orchestrator to chain: `project-scaffold → db-schema → api-gen → ui-gen → auth-scaffold → payments-gen`
- [ ] Create end-to-end integration test with Next.js micro-SaaS L2 config (`docs/examples/nextjs-micro-saas.json`)
- [ ] Generated project passes: `pnpm install && tsc --noEmit && next build`
- [ ] Minimum generation output: 1 API route, 1 DB schema, 1 UI component, auth config, Stripe webhook
- [ ] Operationalize `TaskClassification` schema with types: `scaffold`, `schema_gen`, `route_gen`, `component_gen`, `auth_config`, `payment_config`
- [ ] Extend S16 golden fixture set with task classification entries
- [ ] Extend S16 golden fixture set with decision-log samples
- [ ] Run regression against ALL S16 golden fixtures — verify no contract drift
- [ ] Add `## Code Generation Invariants (Phase 4)` section to `AGENTS.md`
- [ ] Update `AGENTS.md` contract consumer inventory with S17–S23 consumers
- [ ] Update `AGENTS.md` version header to `<!-- VERSION: v4 — {DATE} -->`
- [ ] Create Phase 4 eval suite
- [ ] Run `pnpm install` to regenerate lockfile (if any `package.json` changed)

**Acceptance Criteria:**

- [ ] Orchestrator chains all 6 Phase 4 agents in correct order
- [ ] `run:golden-fixtures` script verified (or created) in `packages/evals/package.json`
- [ ] `TaskClassification` schema verified as extensible before adding Phase 4 types
- [ ] End-to-end test: Next.js L2 config (`docs/examples/nextjs-micro-saas.json`) → complete project → `tsc --noEmit` exits 0
- [ ] End-to-end test: generated project passes `next build` (or equivalent compile check)
- [ ] Generated output includes ≥1 API route, ≥1 DB schema, ≥1 UI component, auth config, Stripe webhook
- [ ] `TaskClassification` schema includes all 6 Phase 4 types
- [ ] S16 golden fixture regression passes (no contract drift)
- [ ] New golden fixtures added for task classification and decision-log entries
- [ ] `AGENTS.md` contains `## Code Generation Invariants (Phase 4)` section
- [ ] `AGENTS.md` contract consumer inventory includes all Phase 4 agents
- [ ] `AGENTS.md` version header updated to v4
- [ ] Phase 4 eval suite passes
- [ ] `pnpm -C packages/contracts check:breaking` exits 0
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```powershell
pnpm install --frozen-lockfile
pnpm -r build
pnpm af pipeline:run --brief 'Next.js micro-SaaS with auth and payments' --l2-config docs/examples/nextjs-micro-saas.json
pnpm -C packages/contracts check:breaking
pnpm -C packages/evals check:agent-manifests
# Golden fixture regression
pnpm -C packages/evals run:golden-fixtures
pnpm factory:health
```

**Cross-Cutting Compliance:**

> - Must import: All Phase 3 orchestrator contracts, all Phase 4 agent contracts
> - Must NOT create: second orchestration system, parallel pipeline execution model
> - Applicable principles: ALL 6 principles apply — this is the integration sprint
> - #6 (Contract validation ownership): This sprint changes cross-cutting contracts (TaskClassification extension, golden fixtures) — consumer inventory and fixtures must ship together

---

## Sprint Log

| Sprint | Milestone | Description                                      | Gate |
| ------ | --------- | ------------------------------------------------ | ---- |
| 17     | S17       | Code Generation Agent — Greenfield Files         | PASS |
| 18     | S18       | Project Scaffold Agent                           | PASS |
| 19     | S19       | Database Schema & Migration Agent                | PASS |
| 20     | S20       | API Route Generation Agent                       | PASS |
| 21     | S21       | Frontend Component Generation Agent              |      |
| 22     | S22       | Authentication Scaffold Agent                    |      |
| 23     | S23       | Payments Integration Agent                       |      |
| 24     | S24       | Full-Stack Integration Test — Next.js Micro-SaaS |      |

---

## Summary

**Phase 4 Sprints:** 8 (S17–S24)
**Estimated Total Effort:** 52–68 hours
**New Agents:** 7 (code-gen, project-scaffold, db-schema, api-gen, ui-gen, auth-scaffold, payments-gen)
**New Contract Schemas:** ~2 types (FileSpec, GeneratedFile) + TaskClassification extension
**Milestone IDs:** S17, S18, S19, S20, S21, S22, S23, S24

### Sprint Dependency Graph

```
S16 (Phase 3 Complete)
 │
 ├── S17 (Code Gen) ──┬── S18 (Scaffold)
 │                     ├── S19 (DB Schema) ── S20 (API Routes) ── S22 (Auth) ── S23 (Payments)
 │                     ├── S21 (UI Gen) ──────────────────────── S22
 │                     └── S20 requires S17 + S19
 │
 └── S24 (Full-Stack Integration) requires S17–S23
```

### Critical Path

```
S16 → S17 → S19 → S20 → S22 → S23 → S24
```

The critical path runs through db-schema → api-gen → auth → payments → integration. S18 (scaffold) and S21 (ui-gen) are parallelizable after S17 and are NOT on the critical path, but S24 blocks on all of them.
