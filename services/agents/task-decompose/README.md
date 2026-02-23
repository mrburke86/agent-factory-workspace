# task-decompose

## Purpose
`task-decompose` converts a project-level brief into deterministic, dependency-aware atomic tasks for orchestrated execution.

## Input Schema (`agent.json`)
- `projectBrief` (string, required): natural-language objective.
- `techStack` (object, required): `{ language, framework, database?, auth?, payments? }`.
- `constraints` (string[], optional): currently supports `max-tasks:<n>`, `no-docs`, `omit-docs`.

## Output Schema (`agent.json`)
- `tasks` (array): ordered task list, each task includes:
  - `id`
  - `title`
  - `description`
  - `dependsOn` (task IDs)
  - `fileScope` (1-3 files)
  - `estimatedComplexity` (`S` | `M` | `L`)

## Decomposition Logic
- No LLM calls and no network access.
- Framework-aware file scope conventions:
  - Express: route/controller/service + test + docs.
  - Next.js: API route + service + test + docs.
  - Generic fallback: entrypoint + feature + test + docs.
- Dependency ordering is validated via topological sort.
- Circular dependencies return `ok: false` with `errors[0].code = "CIRCULAR_DEPENDENCY"`.

## Limits and Heuristics
- Task count: minimum `3`, maximum `15`.
- Task granularity: each task targets `1-3` files.
- Complexity estimate from `fileScope.length`:
  - `S` = 1 file
  - `M` = 2-3 files
  - `L` = 4+ files

## Usage
```bash
pnpm af agent:run task-decompose --input '{"projectBrief":"Add a /health endpoint that returns server status","techStack":{"language":"typescript","framework":"express"}}' --validate-input
```
