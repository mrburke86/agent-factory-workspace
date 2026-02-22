# Layer 2 Configuration: Python CLI Tool

## Project Description

This example models a Python CLI tool for project and task management workflows in local developer environments. Teams can ship deterministic command-line automation quickly by pairing Click for composable command trees, SQLite for embedded relational persistence, and PyPI packaging via `pyproject.toml` and setuptools for distributable releases.

The configuration below demonstrates how Layer 2 parameterizes each Layer 1 pipeline stage for this stack. It is documentation-only and intended to be selected by the sprint loop operator as project context, not executed as an end-to-end runtime artifact.

## Layer 2 Configuration

Reference contracts:
- `AGENTS.md` (`## Two-Layer Architecture`, `## Layer 2 Interface Contract`)
- `docs/templates/layer2-config-schema.md`

```yaml
projectName: "python-cli-tool"
techStack:
  language: "Python 3.11+"
  framework: "Click"
  database: "SQLite"
  distribution: "PyPI (pyproject.toml + setuptools)"
stages:
  plan:
    promptTemplate: |
      Plan the implementation for {{taskDescription}} in a Python Click CLI.
      Consider command tree impact ({{commandTree}}), packaging layout ({{pyprojectPath}}),
      SQLite schema updates ({{sqliteSchemaFiles}}), and migration strategy ({{migrationApproach}}).
      Return a deterministic plan with touched files and verification commands.
    constraints:
      - "Restrict planning to Python, Click, SQLite, and PyPI packaging concerns."
      - "Design command behavior using Click command groups/options/arguments only."
      - "Explicitly describe forward-compatible SQLite migration steps."
    expectedOutputs:
      - "plan.json with steps, touchedFiles, commands, and risks"
      - "SQLite schema and migration change strategy"
      - "CLI command tree impact map"
    acceptanceCriteria:
      - "Plan includes at least one deterministic validation command."
      - "Plan identifies packaging and migration impacts when applicable."
  implement:
    promptTemplate: |
      Implement {{taskDescription}} as surgical unified diffs for {{targetFiles}}.
      Generate Python modules under {{packageRoot}}, wire Click commands via {{cliEntrypoint}},
      and persist data through SQLite access modules in {{storageModule}}.
    constraints:
      - "Modify only in-scope files listed by the plan."
      - "Use typed Python where project typing rules apply."
      - "Keep SQLite access deterministic and scoped to repository-owned files."
    expectedOutputs:
      - "patches/*.diff for changed Python and packaging files"
      - "Click command group/command diffs"
      - "SQLite schema or migration diffs when the data model changes"
    acceptanceCriteria:
      - "Patches apply cleanly without touching lockfiles."
      - "Changed CLI commands include deterministic argument/option handling."
  verify:
    promptTemplate: |
      Verify {{changeSummary}} for {{projectName}} using deterministic commands.
      Run {{installCommand}}, {{buildCommand}}, {{testCommand}}, {{typeCheckCommand}},
      {{lintCommand}}, and {{healthCommand}} in order, then evaluate acceptance checks.
      Expected quality gates include pytest, mypy, and ruff.
    constraints:
      - "Use deterministic local commands only; avoid network-dependent checks."
      - "Record command outputs and exit codes exactly once per command."
      - "Fail verification on packaging, typing, or lint regressions."
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
      Include package build outcomes for wheel/sdist artifacts.
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
      Operate {{projectName}} with CI health gates and release monitoring.
      Review {{healthReportPath}}, {{evalReportPath}}, and {{releaseMetricsPath}},
      then classify status for Python CLI reliability, SQLite integrity, and PyPI release readiness.
      Track CLI error rates and failed command invocations.
    constraints:
      - "Use repository-defined health/eval artifacts as source of truth."
      - "No external service calls during deterministic health classification."
      - "Escalate any drift between local verification and CI outcomes."
    expectedOutputs:
      - ".reports/*.latest.json health snapshots"
      - "Operational status summary with explicit gate result"
      - "Action list for regressions in CLI behavior, migrations, or packaging"
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
      Include Click command targets {{commandTargets}}, pyproject changes {{packagingChanges}},
      SQLite schema impact {{sqliteChanges}}, and migration concerns {{migrationConcerns}}.
    constraints:
      - "Only include files in the declared scope."
      - "Model command UX and data migration risk explicitly."
    expectedOutputs:
      - "plan.json"
      - "Risk list for command breakage, schema migration, and packaging"
    acceptanceCriteria:
      - "Each step maps to one or more concrete files."
```

### Implement Stage

```yaml
stages:
  implement:
    promptTemplate: |
      Generate unified diffs for {{targetFiles}} implementing {{taskDescription}}.
      Use Python modules under {{packageRoot}}, Click command groups in {{cliModule}},
      and SQLite access helpers from {{dbModule}}.
    constraints:
      - "Keep diffs small and surgical."
      - "Avoid non-deterministic code generation."
    expectedOutputs:
      - "patches/*.diff"
      - "Updated command handlers, storage modules, and packaging metadata"
    acceptanceCriteria:
      - "Diffs pass deterministic workspace build and checks."
```

### Verify Stage

```yaml
stages:
  verify:
    promptTemplate: |
      Execute {{installCommand}}, {{buildCommand}}, {{testCommand}}, {{typeCheckCommand}},
      {{lintCommand}}, and {{healthCommand}}.
      Evaluate results against {{acceptanceChecklist}} for command behavior, SQLite persistence, and packaging correctness.
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
      Summarize changed surfaces in {{projectName}} for Click commands, SQLite schema/data access,
      and PyPI packaging files, including wheel/sdist build results.
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
      Report PASS/FAIL with notes for CLI error rate trends, SQLite migration safety,
      and PyPI release readiness from {{releaseArtifact}}.
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

| Layer 1 Stage | Project-Specific Output for Python CLI Tool |
| --- | --- |
| Plan | `plan.json` with command tree updates, touched Python files, SQLite migration strategy, and packaging risk map |
| Implement | `patches/*.diff` for Click command modules, shared Python utilities, SQLite schema/migration files, and `pyproject.toml` packaging metadata |
| Verify | `validate.json` containing deterministic command results for install/build/pytest/mypy/ruff/health checks and acceptance outcomes |
| Integrate | `result.json` and `git-pr.json` combining patch apply status, verification evidence, wheel/sdist build status, and commit readiness summary |
| Operate | `.reports/*.latest.json` plus gate classification notes for CI health, CLI reliability, SQLite data integrity, and PyPI publication readiness |

## How to Use This Example

1. Start from `docs/templates/layer2-example-template.md` if you need a blank scaffold.
2. Keep the discovery heading `## Layer 2 Configuration` unchanged so scanners can detect the file in `docs/examples/`.
3. Validate structure and required fields against `docs/templates/layer2-config-schema.md`.
4. Replace this example's `projectName`, `techStack`, and stage placeholders with your project values while preserving the same field names.
5. Ensure every stage `promptTemplate` includes at least one `{{placeholder}}` and at least one binary `acceptanceCriteria` item.
6. Keep constraints aligned with your declared stack only, consistent with the interface contract in `AGENTS.md`.
