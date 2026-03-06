# project-scaffold

## Purpose
Generate an initial project skeleton from a Layer 2 config while enforcing deterministic output and output scope.

## Contracts
- Input: `{ l2Config, outputDir, correlationId? }`
- Output: `{ scaffoldedFiles, runtimeEvents, recovery? }`
- Reused contract types from `@acme/contracts`:
  - `Layer2Config`
  - `FileSpec`
  - `GeneratedFile`
  - `EventEnvelope`
  - `RecoveryAction`

## Safety Constraints
- File scope enforcement: every generated path must stay inside `outputDir`.
- Multi-file atomicity: if any file fails validation, no files are returned.
- Compile validation: generated TypeScript/TSX files (if present) are validated in `noEmit` mode before success.
- Failure metadata: failures emit `runtimeEvents` and `recovery` using the shared Phase 3 contracts.
- No scaffold-specific state/retry/event system is introduced.

## Eval Strategy
Offline evals validate scaffold structure deterministically:
- `package.json` parses as JSON and includes required Next.js dependencies.
- `tsconfig.json` parses as JSON.
- `scaffoldedFiles[]` entries include `language`.

This avoids network-dependent `pnpm install` in fixtures while still verifying scaffold correctness.

## Usage
```bash
pnpm af agent:validate project-scaffold
pnpm af agent:run project-scaffold --input '{"l2Config":{"projectName":"nextjs-micro-saas","techStack":{"language":"typescript","framework":"nextjs","database":"postgres","auth":"authjs","payments":"stripe"},"stages":{"plan":{"promptTemplate":"Plan {{task}}","constraints":["deterministic"],"expectedOutputs":["plan.json"],"acceptanceCriteria":["has files"]},"implement":{"promptTemplate":"Implement {{task}}","constraints":["small diff"],"expectedOutputs":["patches"],"acceptanceCriteria":["applies cleanly"]}}},"outputDir":"scaffold/nextjs-app"}' --validate-input
```
