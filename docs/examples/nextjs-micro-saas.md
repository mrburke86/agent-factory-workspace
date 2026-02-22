# Layer 2 Configuration: Next.js Micro-SaaS

## Project Description

This example models a multi-tenant micro-SaaS starter built on Next.js App Router with TypeScript. Teams can ship subscription-gated features quickly by pairing Postgres for relational data integrity, Drizzle ORM for type-safe schema and query workflows, Auth.js for session and identity management, and Stripe for billing and subscription lifecycle events.

The configuration below demonstrates how Layer 2 parameterizes each Layer 1 pipeline stage for this stack. It is documentation-only and intended to be selected by the sprint loop operator as project context, not executed as an end-to-end runtime artifact.

## Layer 2 Configuration

Reference contracts:
- `AGENTS.md` (`## Two-Layer Architecture`, `## Layer 2 Interface Contract`)
- `docs/templates/layer2-config-schema.md`

```yaml
projectName: "nextjs-micro-saas"
techStack:
  language: "TypeScript"
  framework: "Next.js App Router"
  database: "Postgres + Drizzle ORM"
  auth: "Auth.js"
  payments: "Stripe"
stages:
  plan:
    promptTemplate: |
      Plan the implementation for {{taskDescription}} in a Next.js App Router SaaS.
      Consider tenant boundaries ({{tenantModel}}), data model changes ({{drizzleSchemaFiles}}),
      auth/session behavior ({{authFlow}}), and Stripe billing impact ({{billingImpact}}).
      Return a deterministic plan with touched files and verification commands.
    constraints:
      - "Restrict planning to TypeScript, Next.js App Router, Postgres/Drizzle, Auth.js, and Stripe concerns."
      - "Propose database access through Drizzle schema/query builders only."
      - "Explicitly model multi-tenant authorization boundaries for every write path."
    expectedOutputs:
      - "plan.json with steps, touchedFiles, commands, and risks"
      - "Migration/change strategy for Drizzle schema updates"
      - "Route-level change map for App Router handlers and server actions"
    acceptanceCriteria:
      - "Plan includes at least one deterministic validation command."
      - "Plan identifies impacted auth and billing surfaces when applicable."
  implement:
    promptTemplate: |
      Implement {{taskDescription}} as surgical unified diffs for {{targetFiles}}.
      Follow App Router conventions for {{routeScope}}, use Drizzle models from {{schemaModule}},
      enforce Auth.js session checks using {{sessionStrategy}}, and integrate Stripe via {{stripeModule}}.
    constraints:
      - "Modify only in-scope files listed by the plan."
      - "Use typed TypeScript changes; avoid introducing untyped any-based flows."
      - "No raw SQL strings for core data access paths; use Drizzle abstractions."
    expectedOutputs:
      - "patches/*.diff for changed TypeScript and config files"
      - "Drizzle schema or migration diffs when the data model changes"
      - "App Router route handler or server action diffs for feature behavior"
    acceptanceCriteria:
      - "Patches apply cleanly without touching lockfiles."
      - "All changed auth-protected routes enforce session and tenant checks."
  verify:
    promptTemplate: |
      Verify {{changeSummary}} for {{projectName}} using deterministic commands.
      Run {{installCommand}}, {{buildCommand}}, and {{healthCommand}} in order, then evaluate
      whether outputs satisfy acceptance checks for schema integrity, App Router behavior,
      Auth.js flows, and Stripe event handling.
    constraints:
      - "Use deterministic local commands only; avoid network-dependent checks."
      - "Record command outputs and exit codes exactly once per command."
      - "Fail verification on missing migration alignment or broken typed contracts."
    expectedOutputs:
      - "validate.json with command results and pass/fail status"
      - "List of failing checks with concise remediation notes when failures occur"
    acceptanceCriteria:
      - "All allowlisted verification commands exit with code 0."
      - "Validation output is deterministic and machine-readable."
  integrate:
    promptTemplate: |
      Integrate {{patchSetId}} for {{projectName}} by orchestrating plan, implement,
      and verify artifacts. Apply patches atomically, produce {{resultArtifact}},
      and summarize readiness for commit with impacted areas: {{impactedAreas}}.
    constraints:
      - "Patch application is atomic; partial applies are not allowed."
      - "Do not modify files outside repository working tree or declared scope."
      - "Preserve deterministic artifact structure and ISO timestamp formatting."
    expectedOutputs:
      - "result.json with final status and evidence pointers"
      - "git-pr.json draft metadata for commit/PR preparation"
      - "Consolidated change summary mapped to plan steps"
    acceptanceCriteria:
      - "Integration fails fast if any patch cannot be applied."
      - "Result artifact references verification outcomes and touched files."
  operate:
    promptTemplate: |
      Operate {{projectName}} with CI health gates and eval monitoring.
      Review {{healthReportPath}} and {{evalReportPath}}, then classify status for
      deployment readiness of Next.js, Postgres/Drizzle migrations, Auth.js auth,
      and Stripe billing paths.
    constraints:
      - "Use repository-defined health/eval artifacts as source of truth."
      - "No external service calls during deterministic health classification."
      - "Escalate any drift between local verification and CI outcomes."
    expectedOutputs:
      - ".reports/*.latest.json health snapshots"
      - "Operational status summary with explicit gate result"
      - "Action list for regressions in auth, billing, or data migrations"
    acceptanceCriteria:
      - "Health gate status is unambiguous (PASS/FAIL) with evidence links."
      - "Any regression includes a concrete next-action recommendation."
```

## Stage Overrides

### Plan Stage

```yaml
stages:
  plan:
    promptTemplate: |
      Produce plan.json for {{taskDescription}} in {{projectName}}.
      Include App Router paths {{appRouterTargets}}, Drizzle schema impact {{drizzleChanges}},
      Auth.js impact {{authConcerns}}, and Stripe impact {{stripeConcerns}}.
    constraints:
      - "Only include files in the declared scope."
      - "Treat tenant isolation as a hard requirement."
    expectedOutputs:
      - "plan.json"
      - "Risk list for auth, billing, and migration paths"
    acceptanceCriteria:
      - "Each step maps to one or more concrete files."
```

### Implement Stage

```yaml
stages:
  implement:
    promptTemplate: |
      Generate unified diffs for {{targetFiles}} implementing {{taskDescription}}.
      Use TypeScript + Next.js App Router patterns, Drizzle models from {{schemaModule}},
      Auth.js session checks via {{authModule}}, and Stripe client from {{stripeModule}}.
    constraints:
      - "Keep diffs small and surgical."
      - "Avoid non-deterministic code generation."
    expectedOutputs:
      - "patches/*.diff"
      - "Updated route handlers, schema files, and billing integration points"
    acceptanceCriteria:
      - "Diffs compile in workspace build."
```

### Verify Stage

```yaml
stages:
  verify:
    promptTemplate: |
      Execute {{installCommand}}, {{buildCommand}}, and {{healthCommand}}.
      Evaluate results against {{acceptanceChecklist}} for App Router, Drizzle, Auth.js, and Stripe paths.
    constraints:
      - "Run commands in deterministic order."
      - "Capture exact exit code and terminal summary."
    expectedOutputs:
      - "validate.json"
      - "Pass/fail matrix per acceptance check"
    acceptanceCriteria:
      - "All required commands return exit code 0."
```

### Integrate Stage

```yaml
stages:
  integrate:
    promptTemplate: |
      Apply {{patchBundle}} atomically and produce {{resultPath}} plus {{gitPrPath}}.
      Summarize changed surfaces in {{projectName}} for App Router, database, auth, and billing.
    constraints:
      - "Abort on first patch apply failure."
      - "Keep artifact layout under .factory/runs/{{correlationId}}/."
    expectedOutputs:
      - "result.json"
      - "git-pr.json"
    acceptanceCriteria:
      - "All patch entries are applied in order without partial state."
```

### Operate Stage

```yaml
stages:
  operate:
    promptTemplate: |
      Classify runtime health for {{projectName}} from {{healthArtifact}} and {{evalArtifact}}.
      Report PASS/FAIL with notes for migration safety, auth/session correctness, and Stripe webhooks.
    constraints:
      - "Use deterministic reports only."
      - "Return explicit next actions for each failing gate."
    expectedOutputs:
      - ".reports/*.latest.json"
      - "Operational summary report"
    acceptanceCriteria:
      - "Status classification is evidence-backed and binary."
```

## Expected Outputs

| Layer 1 Stage | Project-Specific Output for Next.js Micro-SaaS |
| --- | --- |
| Plan | `plan.json` with tenant-aware implementation steps, App Router touched files, Drizzle migration strategy, auth/billing risk map |
| Implement | `patches/*.diff` for route handlers, server actions, Drizzle schema/migration files, Auth.js integration, Stripe billing flows |
| Verify | `validate.json` containing deterministic command results for install/build/health checks and acceptance outcomes |
| Integrate | `result.json` and `git-pr.json` combining patch apply status, verification evidence, and commit readiness summary |
| Operate | `.reports/*.latest.json` plus gate classification notes for CI health, migration safety, auth/session integrity, and billing reliability |

## How to Use This Example

1. Start from `docs/templates/layer2-example-template.md` if you need a blank scaffold.
2. Keep the discovery heading `## Layer 2 Configuration` unchanged so scanners can detect the file in `docs/examples/`.
3. Validate structure and required fields against `docs/templates/layer2-config-schema.md`.
4. Replace this example's `projectName`, `techStack`, and stage placeholders with your project values while preserving the same field names.
5. Ensure every stage `promptTemplate` includes at least one `{{placeholder}}` and at least one binary `acceptanceCriteria` item.
6. Keep constraints aligned with your declared stack only, consistent with the interface contract in `AGENTS.md`.
