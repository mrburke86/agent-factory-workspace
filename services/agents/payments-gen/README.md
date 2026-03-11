# payments-gen

## Purpose
Generate Stripe payment scaffolding for Next.js TypeScript projects:
- Payment models: `one_time`, `subscription`, `usage_based`
- Outputs: Stripe config helpers, webhook handler, checkout route, optional billing component helper
- Stripe-specific behavior: webhook signature verification, idempotency key handling, deterministic error handling

## Input Contract
```json
{
  "paymentSpec": {
    "provider": "stripe",
    "paymentModel": "subscription",
    "webhookEvents": ["checkout.session.completed", "invoice.payment_succeeded"],
    "techStack": { "language": "typescript", "framework": "nextjs-app-router" },
    "checkout": {
      "successUrl": "https://example.test/billing/success",
      "cancelUrl": "https://example.test/billing/cancel"
    },
    "ui": { "billingDashboard": true }
  },
  "outputDir": "src/generated-payments",
  "correlationId": "payments-gen-run"
}
```

## Output Contract
- `webhookHandlers[]`
- `checkoutFiles[]`
- `billingComponents[]` (optional)
- `configFiles[]`
- `decisionLog[]`
- `runtimeEvents[]`
- `recovery?`

Each generated file includes:
- `path`
- `content`
- `language` (extension-derived)

## Decision Logging
- Type name: `DecisionLogEntry`
- Decision level type: `DecisionLevel`
- Level enum values: `full_autonomy`, `supervised`, `human_required`

For S23, `payments-gen` logs:
- `payment-model-architecture` as `human_required`
- `webhook-event-selection` as `supervised`

## Runtime/Recovery Contract Names
The shared contracts currently expose:
- `EventEnvelope` / `EventEnvelopeSchema` (runtime event model)
- `RecoveryAction` (recovery action enum)

`RuntimeEvent` / `RecoveryStrategy` are documentation aliases; this agent uses the actual exported names above.

## Safety Constraints
- File scope enforcement: all paths must remain under `outputDir`
- Compile validation: generated `.ts` files are validated with in-memory `tsc --noEmit`
- Multi-file atomicity: on any validation failure, no generated files are emitted (`ok: false`, empty file arrays)
- Deterministic scaffolding: no network calls, no randomness

## Usage
```bash
pnpm af agent:validate payments-gen
pnpm af agent:run payments-gen --input "$(cat packages/evals/fixtures/payments-gen/payments-gen.fixture.json)" --validate-input
```
