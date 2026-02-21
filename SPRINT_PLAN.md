<!-- LAST_UPDATED: 2026-02-21 -->

# Agent Factory v2 Transformation — Sprint Plan (Single Source of Truth)

> **Purpose:** This document is the authoritative transformation checklist for
> the Agent Factory v2 release. It defines what will be built, what remains,
> and the acceptance criteria for each sprint. Milestone IDs use the S-prefix
> to distinguish from the Layer 1 bootstrap D-prefix milestones.
>
> If work isn't captured here, it's scope creep.

---

## Status Legend

- [x] Done (implemented + verified passing)
- [~] In progress (partially implemented, not fully verified)
- [ ] Not started

---

## Sprint 1: Repo Cleanup — Archive Bootstrap Artefacts

**Objective:** Remove bootstrap-era files from the active workspace surface and establish the v2 directory structure.

**Prerequisites:** None

**Estimated Effort:** 1.5 hours

**Milestone Definition:**
Bootstrap artefacts (`AGENT_FACTORY_MVP.md`, debug config dumps, shared runtime duplicate) are archived into `docs/archive/`. The `docs/` directory structure is created for templates and examples. Root-level noise files are removed or relocated. The workspace compiles and `pnpm factory:health` remains green.

**Tasks:**

- [x] Create directory structure: `docs/archive/`, `docs/templates/`, `docs/examples/`
- [x] Move `AGENT_FACTORY_MVP.md` to `docs/archive/AGENT_FACTORY_MVP.md`
- [x] Delete `_contracts_showConfig.json`, `_contracts_tsc_showConfig.json`, `_evals_tsc_showConfig.json` from repo root
- [x] Delete `hello.txt` from repo root (bootstrap test artifact)
- [~] Delete `compat_snapshot.current.json` from repo root (retained; content differs from `packages/contracts/compat_snapshot.current.json`)
- [~] Reconcile `services/agents/_shared/runtime.ts` — duplicate confirmed; deferred to keep sprint within rollback cap (<=6 changed files)
- [x] Update `.gitignore` to exclude `.factory/runs/` if not already excluded (already excluded via `.factory/`)
- [x] Verify `pnpm install --frozen-lockfile && pnpm -r build && pnpm factory:health` all pass

**Acceptance Criteria:**

- [x] `docs/archive/AGENT_FACTORY_MVP.md` exists
- [x] `AGENT_FACTORY_MVP.md` does NOT exist at repo root
- [x] `_contracts_showConfig.json`, `_contracts_tsc_showConfig.json`, `_evals_tsc_showConfig.json` do NOT exist at repo root
- [x] `hello.txt` does NOT exist at repo root
- [x] `docs/templates/` and `docs/examples/` directories exist
- [x] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify archive exists
test -f docs/archive/AGENT_FACTORY_MVP.md && echo "PASS: archived" || echo "FAIL: not archived"

# Verify root cleanup
test ! -f AGENT_FACTORY_MVP.md && echo "PASS: removed from root" || echo "FAIL: still at root"
test ! -f _contracts_showConfig.json && echo "PASS: debug config removed" || echo "FAIL: debug config remains"
test ! -f _contracts_tsc_showConfig.json && echo "PASS: debug config removed" || echo "FAIL: debug config remains"
test ! -f _evals_tsc_showConfig.json && echo "PASS: debug config removed" || echo "FAIL: debug config remains"
test ! -f hello.txt && echo "PASS: hello.txt removed" || echo "FAIL: hello.txt remains"

# Verify directory structure
test -d docs/templates && echo "PASS: templates dir" || echo "FAIL: no templates dir"
test -d docs/examples && echo "PASS: examples dir" || echo "FAIL: no examples dir"

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 2: Install AGENTS_V2.md — Production Architecture Definition

**Objective:** Replace the bootstrap `AGENTS.md` with the production v2 architecture definition including the two-layer architecture and Layer 2 interface contract.

**Prerequisites:** S1

**Estimated Effort:** 1 hour

**Milestone Definition:**
`AGENTS_V2.md` is installed at the repo root as `AGENTS.md` (replacing the bootstrap version). The old `AGENTS.md` is archived. The new file contains the two-layer architecture section, Layer 2 interface contract, and all preserved invariants from v1. All cross-references in the file are valid.

**Tasks:**

- [ ] Move current `AGENTS.md` to `docs/archive/AGENTS_v1.md`
- [ ] Copy `AGENTS_V2.md` content into the new `AGENTS.md` at repo root
- [ ] Verify all internal references in `AGENTS.md` resolve (file paths, section names)
- [ ] Update the version comment to `<!-- VERSION: v2 — <current date> -->`
- [ ] Verify `pnpm factory:health` passes

**Acceptance Criteria:**

- [ ] `AGENTS.md` at repo root contains `<!-- VERSION: v2` header
- [ ] `AGENTS.md` contains `## Two-Layer Architecture` section
- [ ] `AGENTS.md` contains `## Layer 2 Interface Contract` section
- [ ] `docs/archive/AGENTS_v1.md` exists (bootstrap version preserved)
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify v2 header
grep -q "VERSION: v2" AGENTS.md && echo "PASS: v2 header" || echo "FAIL: no v2 header"

# Verify required sections
grep -q "## Two-Layer Architecture" AGENTS.md && echo "PASS: two-layer section" || echo "FAIL: missing two-layer section"
grep -q "## Layer 2 Interface Contract" AGENTS.md && echo "PASS: L2 contract section" || echo "FAIL: missing L2 contract section"

# Verify archive
test -f docs/archive/AGENTS_v1.md && echo "PASS: v1 archived" || echo "FAIL: v1 not archived"

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 3: Layer 2 Scaffolding — Directory Structure and Template Schema

**Objective:** Create the Layer 2 plug-in interface documentation, including the config schema template and directory conventions.

**Prerequisites:** S1, S2

**Estimated Effort:** 2 hours

**Milestone Definition:**
The `docs/templates/` directory contains a Layer 2 config schema document (`layer2-config-schema.md`) that defines the required structure for all Layer 2 project-specific configurations. A Layer 2 example template (`layer2-example-template.md`) provides a fill-in-the-blank starting point. Both files are consistent with the Layer 2 Interface Contract defined in `AGENTS.md`.

**Tasks:**

- [ ] Create `docs/templates/layer2-config-schema.md` — formal schema definition for Layer 2 configs (required fields, stage override structure, validation rules)
- [ ] Create `docs/templates/layer2-example-template.md` — blank template with section headers, placeholder markers, and inline guidance comments for each section
- [ ] Ensure schema aligns with the Layer 2 Interface Contract in `AGENTS.md` (same required fields, same stage override structure, same validation rules)
- [ ] Verify no broken cross-references between the schema, template, and `AGENTS.md`

**Acceptance Criteria:**

- [ ] `docs/templates/layer2-config-schema.md` exists and contains all required fields from the Layer 2 Interface Contract
- [ ] `docs/templates/layer2-example-template.md` exists and contains section headers for all required schema fields
- [ ] All five pipeline stages (plan, implement, verify, integrate, operate) are represented in the stage overrides section
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify schema file
test -f docs/templates/layer2-config-schema.md && echo "PASS: schema exists" || echo "FAIL: no schema"

# Verify template file
test -f docs/templates/layer2-example-template.md && echo "PASS: template exists" || echo "FAIL: no template"

# Verify schema covers required fields
grep -q "projectName" docs/templates/layer2-config-schema.md && echo "PASS: projectName field" || echo "FAIL: missing projectName"
grep -q "techStack" docs/templates/layer2-config-schema.md && echo "PASS: techStack field" || echo "FAIL: missing techStack"
grep -q "stages" docs/templates/layer2-config-schema.md && echo "PASS: stages field" || echo "FAIL: missing stages"

# Verify all five stages in template
for stage in plan implement verify integrate operate; do
  grep -qi "$stage" docs/templates/layer2-example-template.md && echo "PASS: $stage stage" || echo "FAIL: missing $stage stage"
done

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 4: Layer 2 Example — Next.js Micro-SaaS

**Objective:** Create a comprehensive worked example demonstrating how Layer 2 parameterises Layer 1 for a Next.js micro-SaaS project.

**Prerequisites:** S3

**Estimated Effort:** 2.5 hours

**Milestone Definition:**
`docs/examples/nextjs-micro-saas.md` exists with a complete Layer 2 configuration for a Next.js App Router project using Postgres/Drizzle ORM, Auth.js, and Stripe. The example includes project description, Layer 2 config values, stage-by-stage prompt templates showing how each Layer 1 stage is parameterised, expected outputs per stage, and a "How to Use This Example" section. It conforms to the Layer 2 schema defined in S3.

**Tasks:**

- [ ] Create `docs/examples/nextjs-micro-saas.md` following the Layer 2 example template
- [ ] Write project description section (micro-SaaS context, tech stack rationale)
- [ ] Define Layer 2 config values: `projectName`, `techStack` (Next.js App Router, Postgres, Drizzle ORM, Auth.js, Stripe)
- [ ] Write stage-by-stage prompt templates for all five stages (plan, implement, verify, integrate, operate), each showing concrete parameterisation with Next.js-specific concerns
- [ ] Define expected outputs per stage (e.g., plan stage produces migration files and API route stubs)
- [ ] Write "How to Use This Example" section explaining the workflow for adapting this config
- [ ] Verify all cross-references to `AGENTS.md` and `docs/templates/layer2-config-schema.md` resolve

**Acceptance Criteria:**

- [ ] `docs/examples/nextjs-micro-saas.md` exists
- [ ] File contains `## Layer 2 Configuration` section with all required fields
- [ ] File contains prompt templates for all five pipeline stages
- [ ] File contains `## Expected Outputs` section with per-stage outputs
- [ ] File contains `## How to Use This Example` section
- [ ] Tech stack includes Next.js App Router, Postgres, Drizzle ORM, Auth.js, Stripe
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify file exists
test -f docs/examples/nextjs-micro-saas.md && echo "PASS: file exists" || echo "FAIL: no file"

# Verify required sections
grep -q "## Layer 2 Configuration" docs/examples/nextjs-micro-saas.md && echo "PASS: L2 config section" || echo "FAIL: missing L2 config"
grep -q "## Expected Outputs" docs/examples/nextjs-micro-saas.md && echo "PASS: outputs section" || echo "FAIL: missing outputs"
grep -q "## How to Use This Example" docs/examples/nextjs-micro-saas.md && echo "PASS: how-to section" || echo "FAIL: missing how-to"

# Verify tech stack mentions
for tech in "Next.js" "Postgres" "Drizzle" "Auth.js" "Stripe"; do
  grep -qi "$tech" docs/examples/nextjs-micro-saas.md && echo "PASS: $tech mentioned" || echo "FAIL: $tech not mentioned"
done

# Verify all five stages
for stage in plan implement verify integrate operate; do
  grep -qi "$stage" docs/examples/nextjs-micro-saas.md && echo "PASS: $stage stage" || echo "FAIL: missing $stage"
done

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 5: Layer 2 Example — Python CLI Tool

**Objective:** Create a second Layer 2 example demonstrating language/framework agnosticism with a Python CLI project.

**Prerequisites:** S3

**Estimated Effort:** 2 hours

**Milestone Definition:**
`docs/examples/python-cli-tool.md` exists with a complete Layer 2 configuration for a Python CLI tool using Click, SQLite, and PyPI packaging. Same structure as the Next.js example. Demonstrates that the Agent Factory framework is not JavaScript-specific.

**Tasks:**

- [ ] Create `docs/examples/python-cli-tool.md` following the Layer 2 example template
- [ ] Write project description section (CLI tool context, Python ecosystem rationale)
- [ ] Define Layer 2 config values: `projectName`, `techStack` (Python 3.11+, Click, SQLite, PyPI packaging via setuptools/pyproject.toml)
- [ ] Write stage-by-stage prompt templates for all five stages with Python-specific concerns (e.g., plan stage considers `pyproject.toml` structure, implement stage generates `.py` files)
- [ ] Define expected outputs per stage
- [ ] Write "How to Use This Example" section
- [ ] Verify structural consistency with `docs/examples/nextjs-micro-saas.md`

**Acceptance Criteria:**

- [ ] `docs/examples/python-cli-tool.md` exists
- [ ] File contains `## Layer 2 Configuration` section with all required fields
- [ ] File contains prompt templates for all five pipeline stages
- [ ] File contains `## Expected Outputs` section with per-stage outputs
- [ ] File contains `## How to Use This Example` section
- [ ] Tech stack includes Python, Click, SQLite, PyPI
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify file exists
test -f docs/examples/python-cli-tool.md && echo "PASS: file exists" || echo "FAIL: no file"

# Verify required sections
grep -q "## Layer 2 Configuration" docs/examples/python-cli-tool.md && echo "PASS: L2 config section" || echo "FAIL: missing L2 config"
grep -q "## Expected Outputs" docs/examples/python-cli-tool.md && echo "PASS: outputs section" || echo "FAIL: missing outputs"
grep -q "## How to Use This Example" docs/examples/python-cli-tool.md && echo "PASS: how-to section" || echo "FAIL: missing how-to"

# Verify tech stack mentions
for tech in "Python" "Click" "SQLite" "PyPI"; do
  grep -qi "$tech" docs/examples/python-cli-tool.md && echo "PASS: $tech mentioned" || echo "FAIL: $tech not mentioned"
done

# Verify all five stages
for stage in plan implement verify integrate operate; do
  grep -qi "$stage" docs/examples/python-cli-tool.md && echo "PASS: $stage stage" || echo "FAIL: missing $stage"
done

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 6: Agent README Refresh

**Objective:** Replace placeholder README files in agent directories with accurate documentation of actual behaviour and safety constraints.

**Prerequisites:** S2

**Estimated Effort:** 1.5 hours

**Milestone Definition:**
The three placeholder agent READMEs (`esm-smoke`, `repo-patch`, `retrieval-smoke`) are replaced with accurate documentation describing each agent's purpose, input/output schemas, safety constraints, and usage examples. Each README is consistent with the corresponding `agent.json` manifest.

**Tasks:**

- [ ] Rewrite `services/agents/esm-smoke/README.md` — describe purpose (ESM/NodeNext build validation), input/output contract, usage in evals
- [ ] Rewrite `services/agents/repo-patch/README.md` — describe orchestration pipeline, safety rails (scope enforcement, max files, lockfile protection, command allowlisting), sub-agent chaining, artifact structure
- [ ] Rewrite `services/agents/retrieval-smoke/README.md` — describe purpose (deterministic fixture retrieval), input/output contract, usage in evals
- [ ] Verify each README's input/output descriptions match the corresponding `agent.json` schemas

**Acceptance Criteria:**

- [ ] `services/agents/esm-smoke/README.md` contains more than 10 lines and describes ESM validation purpose
- [ ] `services/agents/repo-patch/README.md` contains more than 20 lines and describes safety constraints
- [ ] `services/agents/retrieval-smoke/README.md` contains more than 10 lines and describes fixture retrieval
- [ ] No README contains generic scaffold placeholder text ("This agent does X" without specifics)
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify README lengths (not placeholders)
for agent in esm-smoke repo-patch retrieval-smoke; do
  lines=$(wc -l < "services/agents/$agent/README.md")
  if [ "$lines" -gt 10 ]; then echo "PASS: $agent README has $lines lines"; else echo "FAIL: $agent README too short ($lines lines)"; fi
done

# Verify repo-patch README mentions safety constraints
grep -qi "scope" services/agents/repo-patch/README.md && echo "PASS: scope mentioned" || echo "FAIL: no scope docs"
grep -qi "lockfile" services/agents/repo-patch/README.md && echo "PASS: lockfile mentioned" || echo "FAIL: no lockfile docs"

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 7: README.md — Comprehensive Onboarding Document

**Objective:** Create the production README.md at the repo root with all required sections for a professional open-source project.

**Prerequisites:** S1, S2, S3, S4, S5

**Estimated Effort:** 3 hours

**Milestone Definition:**
A comprehensive `README.md` exists at the repo root. It contains: title and badges, table of contents, overview with mermaid architecture diagram, quick start guide, architecture deep dive (two-layer explanation), usage guide, annotated directory structure, configuration reference, sprint loop guide (pointing to `WORKFLOW_V2.md`), roadmap, contributing section, and MIT license badge. All internal links and cross-references resolve.

**Tasks:**

- [ ] Create `README.md` at repo root
- [ ] Write title section with badges (CI status, license, Node.js version, pnpm)
- [ ] Generate table of contents
- [ ] Write Overview section with a mermaid diagram showing the two-layer architecture and five pipeline stages
- [ ] Write Quick Start section (clone, install, build, run health check, run a sample agent)
- [ ] Write Architecture section explaining Layer 1 + Layer 2 with references to `AGENTS.md`
- [ ] Write Usage Guide section covering CLI commands (`pnpm af agent:list`, `agent:run`, `agent:validate`, `factory run`)
- [ ] Write annotated Directory Structure section reflecting the current repo layout
- [ ] Write Configuration Reference section (agent.json schema, Layer 2 config fields)
- [ ] Write Sprint Loop Guide section (brief, pointing to `WORKFLOW_V2.md` for details)
- [ ] Write Roadmap section (what's next beyond v2)
- [ ] Write Contributing section (PR process, code style, testing expectations)
- [ ] Write License section (MIT)
- [ ] Verify all internal links resolve (file paths, section anchors)

**Acceptance Criteria:**

- [ ] `README.md` exists at repo root with more than 100 lines
- [ ] Contains all required sections: Overview, Quick Start, Architecture, Usage Guide, Directory Structure, Configuration Reference, Sprint Loop Guide, Roadmap, Contributing, License
- [ ] Contains a mermaid code block for the architecture diagram
- [ ] Contains a table of contents with working anchor links
- [ ] All file path references in Directory Structure section point to real directories/files
- [ ] `pnpm factory:health` exits 0

**Acceptance Commands:**

```bash
# Verify README exists and has substance
test -f README.md && echo "PASS: README exists" || echo "FAIL: no README"
lines=$(wc -l < README.md)
if [ "$lines" -gt 100 ]; then echo "PASS: README has $lines lines"; else echo "FAIL: README too short ($lines lines)"; fi

# Verify required sections
for section in "Overview" "Quick Start" "Architecture" "Usage" "Directory Structure" "Configuration" "Sprint Loop" "Roadmap" "Contributing" "License"; do
  grep -qi "$section" README.md && echo "PASS: $section section" || echo "FAIL: missing $section"
done

# Verify mermaid diagram
grep -q "mermaid" README.md && echo "PASS: mermaid diagram" || echo "FAIL: no mermaid diagram"

# Verify MIT license reference
grep -qi "MIT" README.md && echo "PASS: MIT license" || echo "FAIL: no MIT reference"

# Verify platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health
```

---

## Sprint 8: End-to-End Validation

**Objective:** Verify the full system is internally consistent — all docs, cross-references, CLI commands, and health gates work as documented.

**Prerequisites:** S1, S2, S3, S4, S5, S6, S7

**Estimated Effort:** 2 hours

**Milestone Definition:**
A comprehensive validation pass confirms: `pnpm factory:health` passes, all CLI commands documented in README work, the directory structure matches what README describes, all `.md` files have no broken cross-references (internal file paths and section links all resolve), and the Layer 2 examples conform to the Layer 2 config schema. Any issues found are fixed in this sprint.

**Tasks:**

- [ ] Run `pnpm factory:health` and confirm exit 0
- [ ] Run every CLI command documented in README.md and confirm expected output
- [ ] Verify directory structure in README matches actual repo layout
- [ ] Scan all `.md` files for internal file path references and verify each target exists
- [ ] Verify `docs/examples/nextjs-micro-saas.md` conforms to `docs/templates/layer2-config-schema.md`
- [ ] Verify `docs/examples/python-cli-tool.md` conforms to `docs/templates/layer2-config-schema.md`
- [ ] Fix any broken references, incorrect paths, or stale content found during validation
- [ ] Confirm no file in the repo root references `AGENT_FACTORY_MVP.md` or bootstrap milestone labels (D0–D5)

**Acceptance Criteria:**

- [ ] `pnpm factory:health` exits 0
- [ ] `pnpm af agent:list` exits 0 and lists all agents
- [ ] `pnpm af agent:validate:all` exits 0
- [ ] `pnpm -r build` exits 0
- [ ] No `.md` file at repo root or in `docs/` contains a broken file path reference
- [ ] No file at repo root references `AGENT_FACTORY_MVP.md` (archived)
- [ ] No file at repo root references bootstrap milestone labels D0, D1, D2, D3, D4, D5

**Acceptance Commands:**

```bash
# Full platform health
pnpm install --frozen-lockfile
pnpm -r build
pnpm factory:health

# CLI verification
pnpm af agent:list
pnpm af agent:validate:all
pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}' --validate-input

# Check for stale bootstrap references in active docs
for file in README.md AGENTS.md SPRINT_PLAN.md; do
  if grep -q "AGENT_FACTORY_MVP.md" "$file" 2>/dev/null; then
    echo "FAIL: $file references AGENT_FACTORY_MVP.md"
  else
    echo "PASS: $file clean of bootstrap refs"
  fi
done

# Check no active root-level file references D0-D5 milestones (excluding archive)
grep -rn "D[0-5])" README.md AGENTS.md 2>/dev/null && echo "FAIL: bootstrap milestone refs found" || echo "PASS: no bootstrap milestone refs"

# Verify Layer 2 examples exist and have substance
for example in nextjs-micro-saas python-cli-tool; do
  test -f "docs/examples/$example.md" && echo "PASS: $example exists" || echo "FAIL: $example missing"
done

echo "=== VALIDATION COMPLETE ==="
```

---

## Sprint Log

| Sprint | Milestone | Description | Gate |
| --- | --- | --- | --- |
| 1 | S1 | Repo Cleanup — Archive Bootstrap Artefacts | PASS |

---

## Summary

**Total Sprints:** 8
**Estimated Total Effort:** 15.5 hours (~2–3 days focused work)
**Milestone IDs:** S1, S2, S3, S4, S5, S6, S7, S8

### Sprint Dependency Graph

```
S1 (Cleanup) ──┬── S2 (AGENTS_V2) ──┬── S3 (L2 Scaffolding) ──┬── S4 (Next.js Example)
               │                    │                          └── S5 (Python Example)
               │                    └── S6 (Agent READMEs)
               │
               └── S7 (README) requires S1, S2, S3, S4, S5
                         │
                         └── S8 (Validation) requires ALL above
```
