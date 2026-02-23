# context-gather

## Purpose
`context-gather` scans a local repository and returns a relevance-ranked file list for a task description.

## Input Schema (`agent.json`)
- `repoRoot` (string, required): repository root path to scan.
- `taskDescription` (string, required): natural-language task prompt used for keyword extraction.
- `maxFiles` (number, optional): maximum number of ranked files to return (default `20`).

## Output Schema (`agent.json`)
- `files` (array): ranked files sorted by `relevanceScore` descending.
- `tokenEstimate` (number): rough token estimate for discovered files (`sum(file bytes) / 4`).

## Scoring Heuristic
- Filename keyword match (`0.4`): keyword hits in file path/name.
- Directory proximity (`0.3`): closeness to keyword-matching files in directory structure.
- Import graph (`0.3`): files directly/indirectly connected to keyword-matching files via static `import`/`require` edges.

## Safety Constraints
- Local deterministic traversal only.
- No network calls.
- Skips `.git`, `.factory`, `dist`, `node_modules`.
- Respects `.gitignore` patterns (simple deterministic matching).

## Usage
```bash
pnpm af agent:run context-gather --input '{"repoRoot":"packages/evals/fixtures/context-gather/repo","taskDescription":"add health endpoint"}' --validate-input
```
