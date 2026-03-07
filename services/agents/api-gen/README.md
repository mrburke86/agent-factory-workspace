# api-gen

## Purpose
Generate deterministic API route handlers from route specifications with framework-specific outputs for Next.js App Router (primary) and Express (secondary).

## Contracts
- Input: `{ routes, techStack, schemaRefs?, outputDir, correlationId? }`
- Output: `{ routeFiles, middlewareFiles?, runtimeEvents, recovery? }`
- Reused shared contracts from `@acme/contracts`:
  - `GeneratedFile`
  - `EventEnvelope`
  - `RecoveryAction`

## Supported Targets
- `techStack.framework: "nextjs-app-router"`
- `techStack.framework: "express"`

## Generation Features
- Route handlers generated from `routes[]` (`method`, `path`, `purpose`, `auth`, optional schemas)
- Zod-style validation scaffolding using `safeParse()` for routes that accept input
- Auth-aware scaffolding for `auth: true` routes with early unauthorized responses
- Typed success/error response helpers with deterministic HTTP status handling

## Eval Strategy For Next.js Types
This agent uses **Strategy B (structural validation)**.

Generated Next.js handlers include local structural type stubs for `NextRequest`/`NextResponse` rather than importing `next/server`. This keeps evals offline and deterministic while still producing compile-safe TypeScript route handlers and preserving App Router handler shape (`export async function GET|POST|...`).

## Safety Constraints
- File scope enforcement: generated paths must stay inside `outputDir`.
- Multi-file atomicity: if any generated TypeScript file fails compile validation, the agent returns `ok: false` with no emitted files.
- Compile validation: generated TypeScript route files are validated via TypeScript compiler API in `noEmit` mode.
- Shared failure model only: failures emit `runtimeEvents` and `recovery` through shared contracts (no route-specific orchestration/retry system).

## Usage
```bash
pnpm af agent:validate api-gen
pnpm af agent:run api-gen --input '{"routes":[{"method":"GET","path":"/api/health","purpose":"health check","auth":false},{"method":"POST","path":"/api/posts","purpose":"create post","auth":true,"inputSchema":{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}}],"techStack":{"framework":"nextjs-app-router"},"outputDir":"src/generated-api"}' --validate-input
```
