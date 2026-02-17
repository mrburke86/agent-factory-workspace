# Agent Factory MVP (Repo Patch Agent)

## 0) Repo & toolchain

- [ ] Node version pinned and consistent locally + CI (via `.nvmrc`)
- [ ] pnpm pinned via `packageManager` and Corepack in CI
- [ ] Workspace installs succeed on clean machine (`pnpm install --frozen-lockfile`)
- [ ] `pnpm factory:health` passes locally and in CI

## 1) Factory core contracts

- [ ] Define **Task input schema** (taskId, goal, constraints, filescope, mode)
- [ ] Define **Plan schema** (steps[], risk flags, touched files, commands)
- [ ] Define **Patch schema** (file path, unified diff, rationale)
- [ ] Define **Result schema** (status, outputs, timings, errors)

## 2) CLI entrypoint

- [ ] Add a new workspace package: `packages/factory` (TypeScript)
- [ ] CLI command: `pnpm factory run --task "<text>" [--dry-run] [--scope <path>]`
- [ ] CLI returns non-zero on failure, zero on success
- [ ] CLI prints **one JSON line** summary at end (`factory.result`)

## 3) Logging + observability (non-negotiable)

- [ ] Every run generates `correlationId` (UUID)
- [ ] Log format: JSON lines (default) + optional pretty
- [ ] Emit stage timings (ms): parse → plan → patch → validate → finalize
- [ ] Save run artifacts to `.factory/runs/<correlationId>/`:
  - [ ] `task.json`
  - [ ] `plan.json`
  - [ ] `patches/` (diffs)
  - [ ] `result.json`
  - [ ] `commands.log`

## 4) Safety rails

- [ ] **Dry-run mode** produces patches but does not write files
- [ ] Hard file scope enforcement (`--scope packages/contracts` only touches within scope)
- [ ] Refuse to modify lockfiles unless `--allow-lockfile`
- [ ] Refuse to run arbitrary shell commands unless allowlisted
- [ ] Maximum changed files default: **10**, overridable via flag

## 5) Repo Patch Agent behavior

- [ ] Agent accepts a task like: “Edit packages/contracts/src/events/index.ts to …”
- [ ] Agent produces a deterministic plan (same input → same plan structure)
- [ ] Agent generates a minimal unified diff patch
- [ ] Agent can apply patch to working tree (when not dry-run)
- [ ] Agent adds only intended files to git index

## 6) Validation pipeline

- [ ] Validation step runs in correct workspace context:
  - [ ] `pnpm -r typecheck`
  - [ ] `pnpm -r build`
  - [ ] `pnpm factory:health` (optional “full” validation flag)
- [ ] Validation output captured to `.factory/runs/.../commands.log`
- [ ] If validation fails: agent returns failure + preserves artifacts

## 7) Git integration (PR-ready)

- [ ] Agent creates a branch: `agent/<taskId>-<slug>`
- [ ] Agent commits with message: `agent: <short summary>`
- [ ] Agent outputs next command: `git push -u origin <branch>`
- [ ] (Optional) If `gh` is available: `gh pr create ...` printed, not executed unless `--create-pr`

## 8) CI smoke test for the factory

- [ ] Add `pnpm -C packages/factory test` or `pnpm factory smoke`
- [ ] CI runs smoke test on PRs touching `packages/factory/**`
- [ ] Smoke test runs in < **30s**

## 9) Documentation

- [ ] `docs/agent-factory/README.md`:
  - [ ] install + run examples
  - [ ] flags + modes
  - [ ] artifact outputs
  - [ ] safety rules
