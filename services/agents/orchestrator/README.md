# orchestrator

## Purpose
Chains the single-task MVP pipeline in fixed order:
`context-gather -> plan -> repo-patch -> validate -> git-pr`.

## Behavior
- Validates `task`, `l2Config`, and final output against `@acme/contracts`
- Writes artifacts to `.factory/runs/<correlationId>/`
- Tracks token usage per stage and halts on budget exhaustion
- Calls `error-recover` when a stage fails and enforces the current retry caps
- Supports `_stageRunners` injection for deterministic evals and fixture tests

### Multi-Task Mode
- Accepts `taskList.tasks[]` and executes tasks in topological dependency order
- Records per-task progress events in `progress.jsonl`
- Marks downstream dependents as `skipped` when an upstream dependency fails
- Writes per-task artifacts under `.factory/runs/<correlationId>/tasks/<taskId>/`

## Artifact Layout
- `task.json`
- `l2-config.json`
- `<stage>.json` for each pipeline stage
- `error-recover-<stage>-<attempt>.json` for recovery decisions
- `result.json`

## Local Run
```bash
pnpm -C services/agents/orchestrator build
```
