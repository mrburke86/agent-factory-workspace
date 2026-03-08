# ui-gen

## Purpose
Generate deterministic React/Next.js component TSX files from a component specification, with accessibility-first output defaults.

## Contracts
- Input: `{ componentSpec, designSystem?, outputDir?, correlationId? }`
- Output: `{ componentFiles, pageFiles?, runtimeEvents, recovery? }`
- Reused shared contracts from `@acme/contracts`:
  - `GeneratedFile`
  - `EventEnvelope`
  - `RecoveryAction`

## Generation Defaults
- Design system default: `shadcn/ui` + Tailwind CSS utility classes.
- Responsive default: mobile-first classes with `sm:`, `md:`, `lg:` breakpoints.
- Accessibility default: semantic regions (`article`, `header`, `section`, `footer`) + ARIA labels + keyboard navigation hooks.

## Eval Strategy For React/Next.js Types
This agent uses **Strategy B (structural validation)**.

Generated TSX includes local structural JSX stubs (`declare namespace JSX`) and is compile-checked via the TypeScript compiler API in `noEmit` mode. This keeps evals deterministic and offline without requiring network installs for React/Next type packages.

## Safety Constraints
- File scope enforcement: generated paths must stay inside `outputDir` (defaults to `"."`).
- Multi-file atomicity: if compile/a11y validation fails for any generated file, the run returns `ok: false` and emits no component/page files.
- Compile validation: generated TypeScript/TSX files are validated in `noEmit` mode before success.
- Shared failure model only: failures emit `runtimeEvents` and `recovery` via shared contracts (no UI-specific retry/event subsystem).

## Usage
```bash
pnpm af agent:validate ui-gen
pnpm af agent:run ui-gen --input '{"componentSpec":{"name":"UserCard","purpose":"display user profile","props":[{"name":"user","type":"User","required":true}],"techStack":{"language":"typescript","framework":"next","styling":"tailwind"}}}' --validate-input
```
