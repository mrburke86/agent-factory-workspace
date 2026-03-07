# Codex Step-Chaining Prompt — Sprint [CLAUDE_POPULATES: sprint_number]

<!-- TEMPLATE_VERSION: v4.0 — Phase 4: Full-Stack Code Generation -->

## Reference Documents (on disk)

- `SPRINT_PLAN_v4.md` — living checklist (source of truth)
- `AGENTS.md` — core invariants (hard constraints)

---

## Phase 0: Pre-Parsed Gate Result

> Claude has already analyzed the PowerShell AND CI output. Do NOT re-parse.

### Local Verification Result

```
Gate:        [CLAUDE_POPULATES: PASS | FAIL | FIRST_RUN]
Error Class: [CLAUDE_POPULATES: BUILD_ERROR | TEST_FAILURE | SCHEMA_ERROR | MISSING_FILE | WIRING_ERROR | RUNTIME_ERROR | LOCKFILE_DRIFT | ENV_MISMATCH | DOC_INCOMPLETE | CROSS_REF_BROKEN | FORMAT_ERROR | CONTRACT_MISMATCH | EVAL_FAILURE | CIRCULAR_DEPENDENCY | CODEGEN_COMPILE_ERROR | CODEGEN_SCOPE_VIOLATION | CODEGEN_A11Y_MISSING | DECISION_LOG_MISSING | NONE]
Failing Cmd: [CLAUDE_POPULATES: exact command that failed, or "N/A"]
Error Snip:  [CLAUDE_POPULATES: first 3 lines of error output, or "N/A"]
```

### CI Result (GitHub Actions)

```
CI Gate:     [CLAUDE_POPULATES: PASS | FAIL | PENDING | N/A]
CI Run ID:   [CLAUDE_POPULATES: run ID or "N/A"]
CI Error:    [CLAUDE_POPULATES: failing step + error snippet, or "N/A"]
CI Class:    [CLAUDE_POPULATES: error class if CI-only failure, or "SAME_AS_LOCAL" | "N/A"]
```

### Gate Rules

- If Local Gate is **FAIL**: Do NOT advance milestones. Fix only the minimum
  needed to make `[CLAUDE_POPULATES: failing_command]` pass. Then re-run
  verification.
- If Local Gate is **PASS** but CI Gate is **FAIL**: Do NOT advance milestones.
  Fix the CI-specific failure. The most common cause is lockfile drift — check
  that `pnpm-lock.yaml` is in sync with all `package.json` files.
- If both gates are **PASS** (or **FIRST_RUN**): Proceed to Phase 1.

### Error-Class Fix Guidance

[CLAUDE_POPULATES: One of the following blocks, or "N/A — gate passed"]

<!--
BUILD_ERROR: Fix the specific TypeScript/build error shown above. Check
  tsconfig.json paths, missing exports, and type mismatches. Do not refactor
  surrounding code.

TEST_FAILURE: Fix the failing assertion in the implementation (not the test)
  unless the contract in packages/contracts has changed. Check that output
  shapes match the schema.

SCHEMA_ERROR: Align the implementation with the JSON Schema defined in
  packages/contracts. Do not modify the schema unless the milestone
  explicitly requires it.

MISSING_FILE: Create the missing file or fix the import path. Check that
  agent.json `entry` field points to the correct built output path. Verify
  the file exists after `pnpm -r build`.

WIRING_ERROR: Add the missing script to the appropriate package.json, or
  register the CLI command in packages/factory. Check that the command name
  matches what acceptance tests expect.

RUNTIME_ERROR: Fix the unhandled exception. Check that all imports resolve,
  all exports match their consumers, and no undefined references exist at
  execution time.

LOCKFILE_DRIFT: The lockfile is out of sync with one or more package.json
  files. Run `pnpm install` to regenerate pnpm-lock.yaml, then verify with
  `pnpm install --frozen-lockfile`. Include the updated pnpm-lock.yaml in
  the commit. This MUST pass before pushing.

ENV_MISMATCH: CI fails on a command that passes locally. Reproduce the CI
  constraint: delete node_modules, run `pnpm install --frozen-lockfile`,
  then run the failing command. Fix whatever breaks. Common causes: cached
  modules, uncommitted files, OS path differences.

DOC_INCOMPLETE: The generated documentation is missing one or more required
  sections defined in the milestone. Compare the file against the milestone's
  section checklist. Add all missing sections with appropriate content. Do
  not leave placeholder text.

CROSS_REF_BROKEN: A document contains a reference (file path, section link,
  or document name) that does not resolve to an existing target. Verify every
  reference in the document. Fix broken paths or remove references to files
  that do not yet exist.

FORMAT_ERROR: The markdown structure does not match the required schema.
  Check heading levels, list formatting, code block language tags, table
  alignment, and front matter. Fix structural issues without changing content.

CONTRACT_MISMATCH: An agent's input or output does not match the schema
  defined in packages/contracts. Check that the agent's agent.json
  inputSchema/outputSchema aligns with the TypeScript types and JSON Schema.
  Fix the implementation to match the contract, not the other way around,
  unless the milestone explicitly requires a contract change.

EVAL_FAILURE: A deterministic eval script failed. Check the fixture data,
  expected outputs, and agent implementation. Eval scripts are ground truth
  — fix the agent, not the eval, unless the milestone explicitly redefines
  the eval criteria.

CIRCULAR_DEPENDENCY: Task decomposition produced circular dependency edges.
  Check the dependsOn[] arrays in the task list. Remove or restructure
  dependencies to ensure a valid topological sort. Every task list must be
  a DAG (directed acyclic graph).

CODEGEN_COMPILE_ERROR: Generated code fails tsc --noEmit or equivalent
  compile check. Fix the generation logic so output compiles. Check import
  paths, type references, and export shapes in the generated code. Do not
  skip the compile check — it is a hard requirement for all generation agents.

CODEGEN_SCOPE_VIOLATION: Generated file path falls outside the declared
  outputDir or project root. Fix the path generation logic. All generated
  paths must be relative to the output directory. No absolute paths.

CODEGEN_A11Y_MISSING: Generated UI component is missing required WCAG 2.1 AA
  attributes (ARIA labels, semantic HTML, keyboard navigation). Fix the
  component generation template to include accessibility attributes. Check
  the eval assertion for specific missing attributes.

DECISION_LOG_MISSING: A supervised or human-required decision was made but
  not logged via the DecisionLogEntry interface. Add the missing decision-log
  emit. Check that the decision level matches the Autonomy Taxonomy
  (human_required for auth strategy/provider, payment model; supervised for
  webhook events).
-->

---

## Phase 1: Target Milestone

### Milestone Definition

```
ID:          [CLAUDE_POPULATES: e.g., S17]
Name:        [CLAUDE_POPULATES: e.g., Code Generation Agent — Greenfield Files]
Description: [CLAUDE_POPULATES: full milestone description from SPRINT_PLAN_v4.md]
```

### Previous Milestone (boundary context)

```
ID:          [CLAUDE_POPULATES: e.g., S16]
Status:      [CLAUDE_POPULATES: COMPLETE | IN_PROGRESS]
Key Output:  [CLAUDE_POPULATES: what previous milestone produced, 1-2 lines]
```

### Acceptance Criteria

[CLAUDE_POPULATES: exact checklist items from SPRINT_PLAN_v4.md for this milestone]

### Acceptance Commands

```powershell
[CLAUDE_POPULATES: exact verification commands for this milestone]
```

---

## Phase 2: Applicable Invariants

> Extracted from `AGENTS.md`. Obey all of these.

[CLAUDE_POPULATES: only the invariant sections relevant to this milestone.
For Phase 4 sprints, always include:
- Agent Contract
- Manifest Invariants
- CI / Health Invariants (including Lockfile Invariant)
- Code Generation Invariants (Phase 4) — for S17–S24
- Orchestrator Invariants (Phase 3) — for S24
- Cross-Cutting Principles (Phase 3+)
- Contract Governance (Phase 3+)]

---

## Phase 3: Implementation

### Hard Constraints

- Implement ONLY the milestone defined in Phase 1.
- Smallest possible diff that satisfies ALL acceptance criteria.
- No sweeping refactors.
- Evals remain offline/deterministic (no network calls).
- Windows-safe paths: use `pathToFileURL(...).href` for dynamic imports.
- Exit codes: `0` success, `2` validation/assertion failure, `1` usage/wiring error.
- Any script prints a single-line final JSON event.

**For documentation milestones:** "Implementation" means creating or updating
`.md` files. The same acceptance criteria and verification discipline applies.
Every internal cross-reference (file path, section name, document link) must
resolve to a real target. Do not leave placeholder text or broken references.

**For new agent milestones:** Each new agent MUST include:

1. `agent.json` manifest with valid `inputSchema` and `outputSchema`
2. TypeScript source implementing `run(input)` returning `AgentResult`
3. `README.md` with purpose, input/output contract, safety constraints, usage examples
4. `package.json` with workspace dependencies (`@acme/agent-runtime`, `@acme/contracts`)
5. `tsconfig.json` extending the workspace base config
6. Corresponding eval fixture(s) in `packages/evals`

**For code generation agent milestones (Phase 4):** In addition to the 6
standard agent files, each code generation agent MUST:

1. Validate all generated output compiles via `tsc --noEmit` (or equivalent)
2. Enforce file scope — generated paths must fall within `outputDir`
3. Support multi-file output with atomic semantics (all or nothing)
4. Emit `RuntimeEvent` on failure via the S14 event schema
5. Route recovery through the S13 `RecoveryStrategy` contract
6. NOT create any parallel retry, event, or state management mechanisms
7. Set the `language` field on every `GeneratedFile` output entry

**For auth/payments agents (S22, S23):** In addition to code generation
requirements:

1. Log all Human-required and Supervised decisions via `DecisionLogEntry`
2. Do NOT create agent-specific decision systems
3. Include decision-level annotations matching the Autonomy Taxonomy

**For contract milestones:** New schemas added to `packages/contracts` MUST:

1. Export TypeScript types AND JSON Schema
2. Pass `check:breaking` (no breaking changes to existing exports)
3. Be consumed by at least one agent's `agent.json` schema reference

### Cross-Cutting Compliance

> Extracted from the sprint's compliance requirements. Obey all of these.

**Must import (not reinvent):**
[CLAUDE_POPULATES: list of contracts/modules this sprint must reuse, from SPRINT_PLAN_v4.md]

**Must NOT create:**
[CLAUDE_POPULATES: list of parallel systems this sprint must not build, from SPRINT_PLAN_v4.md]

**Applicable principles:**
[CLAUDE_POPULATES: which of the 6 cross-cutting principles apply to this sprint:
1. One Runtime Task/Event Registry
2. One Retry/Recovery Subsystem
3. One Review-Ready / Delivery-Ready State Model
4. One Task-Type Definition of Done Model
5. One Governance/Runtime Control-Plane Split
6. Contract Validation Ownership]

### Lockfile Rule (non-negotiable)

If you modify ANY `package.json` file (add/remove/change dependencies,
scripts, or metadata), you MUST:

1. Run `pnpm install` to regenerate `pnpm-lock.yaml`.
2. Run `pnpm install --frozen-lockfile` to verify the lockfile is in sync.
3. Include the updated `pnpm-lock.yaml` in the commit.

Failure to do this will cause CI to fail with `ERR_PNPM_OUTDATED_LOCKFILE`.
This is the single most common sprint failure.

### Rollback Rule

If your fix or implementation requires changes to **more than 3 files** for a
FIX sprint, or **more than 8 files** for a new agent sprint, or **more than 6
files** for other new milestone sprints: **STOP**.
Do not proceed. Instead, in your output explain:

1. Why more files are needed
2. What the minimal alternative would be
3. Whether the milestone should be split further

### Implementation Guidance

[CLAUDE_POPULATES: specific technical guidance for this milestone, e.g.,
"Create services/agents/code-gen/ with agent.json, src/index.ts,
package.json, tsconfig.json, and README.md. The agent accepts a FileSpec
input and produces GeneratedFile[] output. Add FileSpec and GeneratedFile
types to packages/contracts. Create eval fixture that validates generated
TypeScript compiles via tsc --noEmit."]

---

## Phase 4: Documentation Updates

### `SPRINT_PLAN_v4.md` Updates

- Check `[x]` ONLY for items completed in this sprint.
- Do NOT uncheck any existing `[x]` items.
- Add/refresh acceptance commands if the milestone defines new ones.
- Append one row to the Sprint Log table:

```
| [CLAUDE_POPULATES: sprint_number] | [CLAUDE_POPULATES: milestone_id] | [CLAUDE_POPULATES: description] | [CLAUDE_POPULATES: PASS/FAIL] |
```

### `AGENTS.md` Updates

- Update ONLY if a core invariant changed in this sprint.
- For S24: Add `## Code Generation Invariants (Phase 4)` section, update
  contract consumer inventory, update version header to v4.
- Update the `<!-- VERSION: YYYY-MM-DD -->` header if changes are made.

### Contract Consumer Inventory Updates

- If this sprint introduces a new agent that consumes existing contracts,
  update the consumer inventory in `packages/contracts` (JSDoc or `CONSUMERS.md`).
- If this sprint introduces new contract types, document initial consumers.

---

## Phase 5: Verification (local)

Run in this exact order:

```powershell
pnpm install --frozen-lockfile
pnpm -r build
[CLAUDE_POPULATES: milestone-specific acceptance commands]
pnpm factory:health
```

**CRITICAL:** `pnpm install --frozen-lockfile` is the FIRST command. If it
fails, the lockfile is out of sync — run `pnpm install` (without the flag)
to regenerate it, then re-run this entire verification sequence.

**Output rule:** Under "Verification (terminal, exact commands)", print
ONLY the commands (one per line). Under "Terminal Output (truncated)", paste
ONLY failing sections (if any) OR the last ~30–60 lines of the final green run.

### Sprint-Specific Checks

> Phase 4 checks — run after standard verification.

**Every sprint:**
- Lockfile regen + `pnpm install --frozen-lockfile` verification

**Code generation agent sprints (S17–S23):**
- Verify all 6 required agent files exist (`agent.json`, `src/index.ts`, `package.json`, `tsconfig.json`, `README.md`, eval fixture)
- Generated output compiles: `tsc --noEmit` on fixture output
- File scope enforcement: test with out-of-scope path → expect `ok: false`

**Scaffold agent sprint (S18):**
- Generated project installs + builds: `pnpm install` + `tsc --noEmit` on scaffold output

**Decision-logging sprints (S22, S23):**
- Decision log entries emit correctly: verify `DecisionLogEntry` output in agent result
- Decision levels match Autonomy Taxonomy

**Integration sprint (S24):**
- Golden fixture regression: `pnpm -C packages/evals run:golden-fixtures`
- End-to-end generation chain produces compilable output
- `TaskClassification` schema includes all 6 Phase 4 types
- `AGENTS.md` updated with Phase 4 invariants section

**Contract sprints (S17 — introduces FileSpec, GeneratedFile):**
- `pnpm -C packages/contracts check:breaking`

---

## Phase 6: Commit + Push

If changes were made: create exactly **one** commit and push to `main`.

### Pre-Push Checklist (automated)

Before pushing, verify:

1. `pnpm install --frozen-lockfile` exits 0 (lockfile is in sync)
2. `pnpm -r build` exits 0 (code compiles)
3. `pnpm factory:health` exits 0 (all gates pass)

If any of these fail, DO NOT push. Fix the issue and re-run.

### Subject format (strict)

`<type>(<scope>): <milestone> — <specific outcome>`

Where:

- type ∈ {feat, fix, refactor, test, docs, chore}
- scope ∈ {ci, factory, runner, runtime, agents, evals, contracts, docs}
- milestone = `[CLAUDE_POPULATES: milestone_id]`
- specific outcome: 12–18 words, concrete artifacts/behaviors, no vague verbs

### Body format (strict)

Exactly 3 bullet lines:

- `Why: <problem/risk addressed, 12–20 words>`
- `What: <key changes as 2–3 concrete nouns/verbs, 12–24 words>`
- `Tests: <exact commands run, comma-separated>`

If no changes: no commit.

---

## Phase 7: CI Gate (post-push)

> After pushing, the user will run these commands to capture CI status.
> Include this section in your output so the user knows what to run.

```bash
# Wait for CI to complete (blocks until done)
gh run watch --exit-status

# If CI fails, capture the failing logs:
# gh run view <run-id> --log-failed
```

You do NOT run these commands. The user runs them and pastes the result into
Claude for the next sprint turn.

---

## Output Expectations

After completing all phases above, provide a natural-language summary of:

1. What you implemented (files created/modified)
2. Which acceptance commands passed or failed
3. The commit subject line (or why no commit was made)
4. Any issues encountered

A structured output capture will follow in a separate prompt.
