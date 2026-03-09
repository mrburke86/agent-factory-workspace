# auth-scaffold

## Purpose
Generate authentication scaffolding for Next.js TypeScript projects:
- Auth strategy: `authjs` (primary) or `jwt` (secondary)
- Providers: `google`, `github`, `email` (`email/password` normalized to `email`)
- Outputs: config, auth route, middleware, protected wrapper HOC, optional login/signup page components

## Input Contract
```json
{
  "authSpec": {
    "strategy": "authjs",
    "providers": ["google", "github"],
    "techStack": { "language": "typescript", "framework": "nextjs-app-router" },
    "ui": { "loginPage": true, "signupPage": true }
  },
  "outputDir": "src/generated-auth",
  "correlationId": "auth-scaffold-run"
}
```

## Output Contract
- `configFiles[]`
- `routeFiles[]`
- `middlewareFiles[]`
- `componentFiles[]` (optional)
- `decisionLog[]`
- `runtimeEvents[]`
- `recovery?`

Each generated file includes:
- `path`
- `content`
- `language` (extension-derived)

## Decision Logging (Verified From `packages/contracts/src/schemas/common.schema.ts`)
- Type name: `DecisionLogEntry`
- Decision level type: `DecisionLevel`
- Level enum values: `full_autonomy`, `supervised`, `human_required`

For S22, `auth-scaffold` logs two `human_required` decisions:
- `auth-strategy`
- `auth-providers`

## Runtime/Recovery Contract Names (Verified)
The shared contracts currently expose:
- `EventEnvelope` / `EventEnvelopeSchema` (runtime event model)
- `RecoveryAction` (recovery action enum)

`RuntimeEvent` / `RecoveryStrategy` are documentation aliases; this agent uses the actual exported names above.

## Safety Constraints
- File scope enforcement: all paths must remain under `outputDir`
- Compile validation: generated `.ts`/`.tsx` files are validated with in-memory `tsc --noEmit`
- Multi-file atomicity: on any validation failure, no generated files are emitted (`ok: false`, empty file arrays)
- Deterministic scaffolding: no network calls, no randomness

## Auth.js Type Strategy
Generated Auth.js scaffolding uses compile-safe local structural types instead of importing `next-auth` types. This keeps evals deterministic and offline.

## Usage
```bash
pnpm af agent:validate auth-scaffold
pnpm af agent:run auth-scaffold --input "$(cat packages/evals/fixtures/auth-scaffold/auth-scaffold.fixture.json)" --validate-input
```
