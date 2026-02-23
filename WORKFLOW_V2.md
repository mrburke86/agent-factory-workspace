# Agent Factory Workflow v2

This document defines the Codex sprint execution loop used in this repository.
It mirrors the Sprint Protocol in `AGENTS.md` and exists as an operator-friendly
reference for day-to-day execution.

## Loop Actors

- Claude Project: compiles the next sprint prompt from prior outputs.
- Codex: executes exactly one milestone and produces one commit when applicable.
- PowerShell (local): runs deterministic acceptance checks and captures exit codes.
- GitHub Actions CI: final clean-environment gate (`--frozen-lockfile`, health checks).
- `gh` CLI: bridges local execution to CI status/log capture.

## Standard Sequence

1. Paste previous Codex output, local verification output, and CI output into Claude.
2. Claude resolves gate status with priority `CI > Local > Codex` and emits the next prompt.
3. Run one sprint in Codex and apply only minimal required changes.
4. Run local verification (`verify-sprint.ps1` or sprint-specific acceptance commands).
5. If local verification passes, push and run `gh run watch --exit-status`.
6. If CI fails, run `gh run view <run-id> --log-failed`, then feed failure context back to Claude.
7. Mark the milestone complete only after both local and CI gates pass.

## Sprint Constraints

- One milestone per sprint.
- No milestone skipping.
- Small, surgical diffs.
- `pnpm factory:health` stays green.
- Lockfile remains synchronized with workspace `package.json` files.

## CI Triage Commands

```bash
gh run watch --exit-status
gh run view --log-failed
gh run list --limit 5
```
