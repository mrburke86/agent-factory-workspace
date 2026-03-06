# code-gen

## Purpose
Generate greenfield files from `FileSpec` input while enforcing output scope and deterministic output.

## Contracts
- Input contract: `CodeGenInput` from `@acme/contracts`
- Output contract: `CodeGenOutput` from `@acme/contracts`
- Generated file entries: `GeneratedFile[]`

Verified existing contract names used for S17:
- Runtime event contract: `EventEnvelope` / `EventEnvelopeSchema`
- Recovery contract: `RecoveryAction` / `RecoveryActionSchema`

## Safety Constraints
- File scope enforcement: every generated path must stay under `outputDir` (defaults to project root `"."`).
- Compile validation: generated TypeScript/TSX files are validated with TypeScript compiler API in `noEmit` mode before returning.
- Multi-file atomicity: if any file fails validation, the run returns `ok: false` and emits no generated files.
- Failure metadata: failures include `runtimeEvents` (`EventEnvelope`) and a `recovery` recommendation using `RecoveryAction`.

## Usage
```bash
pnpm af agent:validate code-gen
pnpm af agent:run code-gen --input '{"fileSpec":{"path":"src/utils/helpers.ts","purpose":"utility functions","techStack":{"language":"typescript","framework":"node"}}}' --validate-input
```

Multi-file example:
```bash
pnpm af agent:run code-gen --input '{"outputDir":"src/generated","fileSpecs":[{"path":"math/add.ts","purpose":"add helper","techStack":{"language":"typescript","framework":"node"}},{"path":"math/subtract.ts","purpose":"subtract helper","techStack":{"language":"typescript","framework":"node"}}]}' --validate-input
```
