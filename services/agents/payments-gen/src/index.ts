import path from "node:path";
import ts from "typescript";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  DecisionLogEntrySchema,
  EventEnvelopeSchema,
  FileSpecSchema,
  GeneratedFileSchema,
  type DecisionLevel,
  type DecisionLogEntry,
  type EventEnvelope,
  type FileSpec,
  type GeneratedFile,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "payments-gen";
const DEFAULT_OUTPUT_DIR = ".";
const SUPPORTED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "customer.subscription.updated",
  "invoice.upcoming",
] as const;

type PaymentModel = "one_time" | "subscription" | "usage_based";
type StripeProvider = "stripe";

type PaymentsGenInput = {
  paymentSpec: {
    provider: string;
    paymentModel: string;
    webhookEvents: string[];
    techStack: {
      language: string;
      framework: string;
    };
    checkout?: {
      successUrl?: string;
      cancelUrl?: string;
    };
    ui?: {
      billingDashboard?: boolean;
    };
  };
  outputDir: string;
  correlationId?: string;
};

type PaymentsGenRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type PaymentsGenOutput = {
  webhookHandlers: GeneratedFile[];
  checkoutFiles: GeneratedFile[];
  billingComponents?: GeneratedFile[];
  configFiles: GeneratedFile[];
  decisionLog: DecisionLogEntry[];
  runtimeEvents: EventEnvelope[];
  recovery?: PaymentsGenRecovery;
};

type ParsedInput = {
  provider: StripeProvider;
  paymentModel: PaymentModel;
  webhookEvents: string[];
  outputDir: string;
  successUrl: string;
  cancelUrl: string;
  includeBillingComponent: boolean;
};

type PaymentsGenErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class PaymentsGenError extends Error {
  readonly code: PaymentsGenErrorCode;

  constructor(code: PaymentsGenErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(normalizeSlashes(value));
}

function resolveOutputPath(outputDir: string, filePath: string): string {
  const normalizedOutputDir = path.posix.normalize(normalizeSlashes(outputDir.trim() || DEFAULT_OUTPUT_DIR));
  const normalizedFilePath = path.posix.normalize(normalizeSlashes(filePath.trim()));

  if (normalizedOutputDir.length === 0) {
    throw new PaymentsGenError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new PaymentsGenError("SCOPE_VIOLATION", `outputDir must be project-relative and non-escaping: ${outputDir}`);
  }

  if (normalizedFilePath.length === 0) {
    throw new PaymentsGenError("INPUT_INVALID", "generated file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new PaymentsGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new PaymentsGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (normalizedOutputDir !== ".") {
    if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
      throw new PaymentsGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
    }
  }

  return resolvedPath;
}

function detectLanguage(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".json":
      return "json";
    default:
      return "plaintext";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaymentsGenError("INPUT_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeProvider(raw: unknown): StripeProvider {
  const value = assertNonEmptyString(raw, "paymentSpec.provider").toLowerCase();
  if (value === "stripe") {
    return "stripe";
  }
  throw new PaymentsGenError("INPUT_INVALID", `unsupported payment provider: ${String(raw)}`);
}

function normalizePaymentModel(raw: unknown): PaymentModel {
  const value = assertNonEmptyString(raw, "paymentSpec.paymentModel").toLowerCase();
  if (value === "one_time" || value === "one-time" || value === "one time") {
    return "one_time";
  }
  if (value === "subscription" || value === "subscriptions") {
    return "subscription";
  }
  if (value === "usage_based" || value === "usage-based" || value === "usage based" || value === "metered") {
    return "usage_based";
  }
  throw new PaymentsGenError("INPUT_INVALID", `unsupported payment model: ${String(raw)}`);
}

function normalizeLanguage(raw: unknown): void {
  const value = assertNonEmptyString(raw, "paymentSpec.techStack.language").toLowerCase();
  if (value === "typescript" || value === "ts") {
    return;
  }
  throw new PaymentsGenError("UNSUPPORTED_STACK", `unsupported language for payments-gen: ${String(raw)}`);
}

function normalizeFramework(raw: unknown): void {
  const value = assertNonEmptyString(raw, "paymentSpec.techStack.framework").toLowerCase();
  if (value === "next" || value === "nextjs" || value === "next.js" || value === "nextjs-app-router") {
    return;
  }
  throw new PaymentsGenError("UNSUPPORTED_STACK", `unsupported framework for payments-gen: ${String(raw)}`);
}

function uniqueNonEmptyStrings(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PaymentsGenError("INPUT_INVALID", `${label} must be a non-empty array`);
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = assertNonEmptyString(entry, `${label}[]`);
    if (!seen.has(value)) {
      values.push(value);
      seen.add(value);
    }
  }

  return values;
}

function parseInput(input: PaymentsGenInput): ParsedInput {
  if (!isObject(input)) {
    throw new PaymentsGenError("INPUT_INVALID", "input must be an object");
  }
  if (!isObject(input.paymentSpec)) {
    throw new PaymentsGenError("INPUT_INVALID", "paymentSpec must be an object");
  }
  if (!isObject(input.paymentSpec.techStack)) {
    throw new PaymentsGenError("INPUT_INVALID", "paymentSpec.techStack must be an object");
  }

  const provider = normalizeProvider(input.paymentSpec.provider);
  const paymentModel = normalizePaymentModel(input.paymentSpec.paymentModel);
  const webhookEvents = uniqueNonEmptyStrings(input.paymentSpec.webhookEvents, "paymentSpec.webhookEvents");
  normalizeLanguage(input.paymentSpec.techStack.language);
  normalizeFramework(input.paymentSpec.techStack.framework);

  const checkoutSpec = isObject(input.paymentSpec.checkout) ? input.paymentSpec.checkout : {};
  const uiSpec = isObject(input.paymentSpec.ui) ? input.paymentSpec.ui : {};

  return {
    provider,
    paymentModel,
    webhookEvents,
    outputDir: assertNonEmptyString(input.outputDir, "outputDir"),
    successUrl:
      typeof checkoutSpec.successUrl === "string" && checkoutSpec.successUrl.trim().length > 0
        ? checkoutSpec.successUrl.trim()
        : "https://example.test/billing/success",
    cancelUrl:
      typeof checkoutSpec.cancelUrl === "string" && checkoutSpec.cancelUrl.trim().length > 0
        ? checkoutSpec.cancelUrl.trim()
        : "https://example.test/billing/cancel",
    includeBillingComponent: uiSpec.billingDashboard !== false && paymentModel !== "one_time",
  };
}

function defaultFileSpecs(): FileSpec[] {
  return [
    FileSpecSchema.parse({
      path: "src/payments/stripe.ts",
      purpose: "Shared Stripe configuration and checkout helpers",
      techStack: { language: "typescript", framework: "nextjs-app-router" },
      templateHints: ["stripe", "checkout", "config"],
    }),
    FileSpecSchema.parse({
      path: "src/app/api/stripe/webhook/route.ts",
      purpose: "Stripe webhook handler with signature verification",
      techStack: { language: "typescript", framework: "nextjs-app-router" },
      templateHints: ["stripe", "webhook", "signature-verification"],
    }),
    FileSpecSchema.parse({
      path: "src/app/api/stripe/checkout/route.ts",
      purpose: "Stripe checkout creation flow with idempotency key handling",
      techStack: { language: "typescript", framework: "nextjs-app-router" },
      templateHints: ["stripe", "checkout", "idempotency"],
    }),
    FileSpecSchema.parse({
      path: "src/components/billing/stripe-billing-card.ts",
      purpose: "Billing component helper for subscription and usage-based plans",
      techStack: { language: "typescript", framework: "nextjs-app-router" },
      templateHints: ["billing", "component"],
    }),
  ];
}

function createGeneratedFile(outputDir: string, relativePath: string, content: string): GeneratedFile {
  const resolvedPath = resolveOutputPath(outputDir, relativePath);
  const language = detectLanguage(resolvedPath);
  return GeneratedFileSchema.parse({ path: resolvedPath, content, language });
}

function createDecisionLogEntry(entry: {
  key: string;
  level: DecisionLevel;
  summary: string;
  rationale: string;
  selectedOption: string;
  alternatives?: string[];
}): DecisionLogEntry {
  return DecisionLogEntrySchema.parse(entry);
}

function buildDecisionLog(input: ParsedInput): DecisionLogEntry[] {
  const humanRequiredLevel: DecisionLevel = "human_required";
  const supervisedLevel: DecisionLevel = "supervised";
  return [
    createDecisionLogEntry({
      key: "payment-model-architecture",
      level: humanRequiredLevel,
      summary: "Payment model architecture selected",
      rationale:
        "Payment model architecture determines pricing behavior, billing semantics, and revenue recognition obligations.",
      selectedOption: input.paymentModel,
      alternatives: ["one_time", "subscription", "usage_based"],
    }),
    createDecisionLogEntry({
      key: "webhook-event-selection",
      level: supervisedLevel,
      summary: "Stripe webhook events selected",
      rationale:
        "Webhook event selection affects operational coverage and downstream fulfillment logic, so the agent proposes a supervised set.",
      selectedOption: input.webhookEvents.join(","),
      alternatives: [...SUPPORTED_WEBHOOK_EVENTS],
    }),
  ];
}

function buildStripeConfigContent(input: ParsedInput): string {
  const checkoutMode = input.paymentModel === "one_time" ? "payment" : "subscription";
  const meteredLiteral = input.paymentModel === "usage_based" ? "true" : "false";
  const webhookEventsLiteral = input.webhookEvents.map((event) => `"${event}"`).join(", ");

  return [
    `// Generated by ${AGENT_NAME}: shared Stripe helpers.`,
    "",
    "export type StripeEvent = {",
    "  id: string;",
    "  type: string;",
    "  data: { object: Record<string, unknown> };",
    "};",
    "",
    "export type StripeLike = {",
    "  webhooks: {",
    "    constructEvent(payload: string, signature: string, secret: string): StripeEvent;",
    "  };",
    "  checkout: {",
    "    sessions: {",
    "      create(input: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<Record<string, unknown>>;",
    "    };",
    "  };",
    "  billingPortal?: {",
    "    sessions?: {",
    "      create(input: Record<string, unknown>): Promise<Record<string, unknown>>;",
    "    };",
    "  };",
    "};",
    "",
    "export type PaymentModel = \"one_time\" | \"subscription\" | \"usage_based\";",
    "",
    `export const PAYMENT_PROVIDER = "${input.provider}" as const;`,
    `export const PAYMENT_MODEL: PaymentModel = "${input.paymentModel}";`,
    `export const STRIPE_WEBHOOK_EVENTS = [${webhookEventsLiteral}] as const;`,
    "export const STRIPE_WEBHOOK_SECRET_ENV = \"STRIPE_WEBHOOK_SECRET\" as const;",
    `export const DEFAULT_SUCCESS_URL = ${JSON.stringify(input.successUrl)} as const;`,
    `export const DEFAULT_CANCEL_URL = ${JSON.stringify(input.cancelUrl)} as const;`,
    `export const USES_METERED_BILLING = ${meteredLiteral} as const;`,
    "",
    "export type CheckoutInput = {",
    "  priceId: string;",
    "  successUrl?: string;",
    "  cancelUrl?: string;",
    "  customerId?: string;",
    "  quantity?: number;",
    "  idempotencyKey: string;",
    "};",
    "",
    "export function buildCheckoutPayload(input: CheckoutInput): Record<string, unknown> {",
    `  const mode = "${checkoutMode}" as const;`,
    "  const payload: Record<string, unknown> = {",
    "    mode,",
    "    success_url: input.successUrl ?? DEFAULT_SUCCESS_URL,",
    "    cancel_url: input.cancelUrl ?? DEFAULT_CANCEL_URL,",
    "    customer: input.customerId,",
    "    line_items: [",
    "      {",
    "        price: input.priceId,",
    "        quantity: input.quantity ?? 1,",
    "      },",
    "    ],",
    "    metadata: {",
    "      paymentModel: PAYMENT_MODEL,",
    "      metered: String(USES_METERED_BILLING),",
    "    },",
    "  };",
    "  return payload;",
    "}",
    "",
    "export async function createCheckoutSession(stripe: StripeLike, input: CheckoutInput): Promise<Record<string, unknown>> {",
    "  if (input.idempotencyKey.trim().length === 0) {",
    "    throw new Error(\"idempotencyKey is required for Stripe checkout session creation\");",
    "  }",
    "  return stripe.checkout.sessions.create(buildCheckoutPayload(input), {",
    "    idempotencyKey: input.idempotencyKey,",
    "  });",
    "}",
    "",
    "export async function createBillingPortalSession(",
    "  stripe: StripeLike,",
    "  customerId: string,",
    "  returnUrl: string,",
    "): Promise<Record<string, unknown>> {",
    "  if (!stripe.billingPortal?.sessions) {",
    "    throw new Error(\"billing portal client is not configured\");",
    "  }",
    "  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });",
    "}",
    "",
  ].join("\n");
}

function buildWebhookHandlerContent(input: ParsedInput): string {
  const switchCases = input.webhookEvents
    .map((event) =>
      [
        `    case ${JSON.stringify(event)}:`,
        "      return {",
        "        eventId: event.id,",
        "        type: event.type,",
        "        handled: true,",
        "      };",
      ].join("\n"),
    )
    .join("\n");

  return [
    `// Generated by ${AGENT_NAME}: Stripe webhook handler.`,
    "",
    "type StripeEvent = {",
    "  id: string;",
    "  type: string;",
    "  data: { object: Record<string, unknown> };",
    "};",
    "",
    "type StripeLike = {",
    "  webhooks: {",
    "    constructEvent(payload: string, signature: string, secret: string): StripeEvent;",
    "  };",
    "};",
    "",
    `const STRIPE_WEBHOOK_EVENTS = [${input.webhookEvents.map((event) => JSON.stringify(event)).join(", ")}] as const;`,
    'const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET" as const;',
    "",
    "export type HandledStripeWebhook = {",
    "  eventId: string;",
    "  type: string;",
    "  handled: boolean;",
    "};",
    "",
    "function isHandledEvent(eventType: string): boolean {",
    "  return new Set<string>(STRIPE_WEBHOOK_EVENTS).has(eventType);",
    "}",
    "",
    "export function verifyStripeWebhook(args: {",
    "  stripe: StripeLike;",
    "  rawBody: string;",
    "  signature: string;",
    "  webhookSecret: string;",
    "}): StripeEvent {",
    "  const event = args.stripe.webhooks.constructEvent(args.rawBody, args.signature, args.webhookSecret);",
    "  return event;",
    "}",
    "",
    "export async function handleStripeWebhook(args: {",
    "  stripe: StripeLike;",
    "  rawBody: string;",
    "  signature: string;",
    "}): Promise<HandledStripeWebhook> {",
    '  const webhookSecret = process.env[STRIPE_WEBHOOK_SECRET_ENV] ?? "test_webhook_secret";',
    "  const event = verifyStripeWebhook({",
    "    stripe: args.stripe,",
    "    rawBody: args.rawBody,",
    "    signature: args.signature,",
    "    webhookSecret,",
    "  });",
    "",
    "  if (!isHandledEvent(event.type)) {",
    "    return {",
    "      eventId: event.id,",
    "      type: event.type,",
    "      handled: false,",
    "    };",
    "  }",
    "",
    "  switch (event.type) {",
    switchCases,
    "    default:",
    "      return {",
    "        eventId: event.id,",
    "        type: event.type,",
    "        handled: false,",
    "      };",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildCheckoutRouteContent(input: ParsedInput): string {
  const checkoutMode = input.paymentModel === "one_time" ? "payment" : "subscription";
  return [
    `// Generated by ${AGENT_NAME}: Stripe checkout flow.`,
    "",
    "type StripeLike = {",
    "  checkout: {",
    "    sessions: {",
    "      create(input: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<Record<string, unknown>>;",
    "    };",
    "  };",
    "};",
    "",
    `const PAYMENT_MODEL = "${input.paymentModel}" as const;`,
    `const CHECKOUT_MODE = "${checkoutMode}" as const;`,
    `const DEFAULT_SUCCESS_URL = ${JSON.stringify(input.successUrl)} as const;`,
    `const DEFAULT_CANCEL_URL = ${JSON.stringify(input.cancelUrl)} as const;`,
    "",
    "export type CheckoutRouteRequest = {",
    "  stripe: StripeLike;",
    "  priceId: string;",
    "  customerId?: string;",
    "  quantity?: number;",
    "  successUrl?: string;",
    "  cancelUrl?: string;",
    "  idempotencyKey: string;",
    "};",
    "",
    "function createCheckoutSession(stripe: StripeLike, input: CheckoutRouteRequest): Promise<Record<string, unknown>> {",
    "  if (input.idempotencyKey.trim().length === 0) {",
    "    throw new Error(\"idempotencyKey is required for Stripe checkout session creation\");",
    "  }",
    "  return stripe.checkout.sessions.create(",
    "    {",
    "      mode: CHECKOUT_MODE,",
    "      success_url: input.successUrl ?? DEFAULT_SUCCESS_URL,",
    "      cancel_url: input.cancelUrl ?? DEFAULT_CANCEL_URL,",
    "      customer: input.customerId,",
    "      line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],",
    "      metadata: { paymentModel: PAYMENT_MODEL },",
    "    },",
    "    { idempotencyKey: input.idempotencyKey },",
    "  );",
    "}",
    "",
    "export async function createStripeCheckoutRoute(input: CheckoutRouteRequest): Promise<Record<string, unknown>> {",
    "  return createCheckoutSession(input.stripe, input);",
    "}",
    "",
    "export function describePaymentModel(): string {",
    "  return PAYMENT_MODEL;",
    "}",
    "",
  ].join("\n");
}

function buildBillingComponentContent(input: ParsedInput): string {
  const usageHint = input.paymentModel === "usage_based" ? "Usage summary supported" : "Usage summary optional";
  return [
    `// Generated by ${AGENT_NAME}: billing component helper.`,
    "",
    `const PAYMENT_MODEL = "${input.paymentModel}" as const;`,
    "",
    "export type BillingCardData = {",
    "  customerId: string;",
    "  subscriptionStatus: string;",
    "  usageSummary?: string;",
    "};",
    "",
    "export function renderStripeBillingCard(data: BillingCardData): string {",
    "  const lines = [",
    "    `Customer: ${data.customerId}`,",
    "    `Status: ${data.subscriptionStatus}`,",
    "    `Model: ${PAYMENT_MODEL}`,",
    `    ${JSON.stringify(usageHint)},`,
    "  ];",
    "  if (data.usageSummary) {",
    "    lines.push(`Usage: ${data.usageSummary}`);",
    "  }",
    "  return lines.join(\"\\n\");",
    "}",
    "",
  ].join("\n");
}

function formatDiagnostic(diagnostic: ts.Diagnostic, virtualToGeneratedPath: Map<string, string>): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `tsc: ${message}`;
  }

  const normalizedVirtualPath = path.normalize(diagnostic.file.fileName);
  const generatedPath = virtualToGeneratedPath.get(normalizedVirtualPath) ?? diagnostic.file.fileName;
  const lineAndChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${generatedPath}:${lineAndChar.line + 1}:${lineAndChar.character + 1} ${message}`;
}

function validateTypeScriptCompilation(files: GeneratedFile[]): void {
  const tsFiles = files.filter((file) => file.language === "typescript" || file.language === "typescriptreact");
  if (tsFiles.length === 0) {
    return;
  }

  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const virtualContents = new Map<string, { content: string; scriptKind: ts.ScriptKind }>();
  const virtualToGeneratedPath = new Map<string, string>();

  for (const file of tsFiles) {
    const virtualAbsolutePath = path.normalize(path.resolve(process.cwd(), ".factory", "virtual", AGENT_NAME, file.path));
    virtualToGeneratedPath.set(virtualAbsolutePath, file.path);
    virtualContents.set(virtualAbsolutePath, {
      content: file.content,
      scriptKind: file.language === "typescriptreact" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    });
  }

  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => virtualContents.has(path.normalize(fileName)) || defaultHost.fileExists(fileName),
    readFile: (fileName) => {
      const virtual = virtualContents.get(path.normalize(fileName));
      if (virtual) {
        return virtual.content;
      }
      return defaultHost.readFile(fileName);
    },
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const virtual = virtualContents.get(path.normalize(fileName));
      if (virtual) {
        return ts.createSourceFile(fileName, virtual.content, languageVersion, true, virtual.scriptKind);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
  };

  const program = ts.createProgram({
    rootNames: Array.from(virtualContents.keys()),
    options: compilerOptions,
    host,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length === 0) {
    return;
  }

  const diagnosticMessages = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, virtualToGeneratedPath));
  throw new PaymentsGenError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function buildGeneratedFiles(input: ParsedInput): {
  webhookHandlers: GeneratedFile[];
  checkoutFiles: GeneratedFile[];
  billingComponents: GeneratedFile[];
  configFiles: GeneratedFile[];
} {
  const fileSpecs = defaultFileSpecs();
  const configFiles: GeneratedFile[] = [];
  const webhookHandlers: GeneratedFile[] = [];
  const checkoutFiles: GeneratedFile[] = [];
  const billingComponents: GeneratedFile[] = [];

  for (const spec of fileSpecs) {
    if (spec.path === "src/payments/stripe.ts") {
      configFiles.push(createGeneratedFile(input.outputDir, spec.path, buildStripeConfigContent(input)));
      continue;
    }
    if (spec.path === "src/app/api/stripe/webhook/route.ts") {
      webhookHandlers.push(createGeneratedFile(input.outputDir, spec.path, buildWebhookHandlerContent(input)));
      continue;
    }
    if (spec.path === "src/app/api/stripe/checkout/route.ts") {
      checkoutFiles.push(createGeneratedFile(input.outputDir, spec.path, buildCheckoutRouteContent(input)));
      continue;
    }
    if (spec.path === "src/components/billing/stripe-billing-card.ts" && input.includeBillingComponent) {
      billingComponents.push(createGeneratedFile(input.outputDir, spec.path, buildBillingComponentContent(input)));
    }
  }

  const allFiles = [...configFiles, ...webhookHandlers, ...checkoutFiles, ...billingComponents];
  if (allFiles.length === 0) {
    throw new PaymentsGenError("GENERATION_FAILED", "payments scaffolding generated no files");
  }

  const seen = new Set<string>();
  for (const file of allFiles) {
    if (seen.has(file.path)) {
      throw new PaymentsGenError("INPUT_INVALID", `duplicate generated path: ${file.path}`);
    }
    seen.add(file.path);
  }

  validateTypeScriptCompilation(allFiles);

  return {
    webhookHandlers,
    checkoutFiles,
    billingComponents,
    configFiles,
  };
}

function recoveryForError(code: PaymentsGenErrorCode): PaymentsGenRecovery {
  if (code === "INPUT_INVALID" || code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Payments input or output scope is invalid; retry with schema-compliant values.",
    };
  }
  if (code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated payment files failed TypeScript noEmit validation; retry with compile-safe scaffolding.",
    };
  }
  if (code === "UNSUPPORTED_STACK") {
    return {
      action: "escalate",
      rationale: "payments-gen currently supports Stripe on TypeScript Next.js stacks; escalate unsupported stack decisions.",
    };
  }
  return {
    action: "escalate",
    rationale: "Unexpected payments-gen failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: PaymentsGenErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "payments-gen.failed",
    eventVersion: "v1",
    occurredAt: nowIso(),
    correlationId,
    payload: {
      agent: AGENT_NAME,
      error: { code, message },
      recoveryAction,
    },
  });
}

function parseCorrelationId(rawInput: unknown): string {
  if (
    rawInput &&
    typeof rawInput === "object" &&
    typeof (rawInput as { correlationId?: unknown }).correlationId === "string" &&
    (rawInput as { correlationId: string }).correlationId.trim().length > 0
  ) {
    return (rawInput as { correlationId: string }).correlationId.trim();
  }
  return AGENT_NAME;
}

function toPaymentsGenError(error: unknown): { code: PaymentsGenErrorCode; message: string } {
  if (error instanceof PaymentsGenError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "GENERATION_FAILED", message: error.message };
  }
  return { code: "GENERATION_FAILED", message: String(error) };
}

async function runImpl(input: PaymentsGenInput): Promise<PaymentsGenOutput> {
  const parsedInput = parseInput(input);
  const decisionLog = buildDecisionLog(parsedInput);
  const generated = buildGeneratedFiles(parsedInput);

  return {
    webhookHandlers: generated.webhookHandlers,
    checkoutFiles: generated.checkoutFiles,
    billingComponents: generated.billingComponents.length > 0 ? generated.billingComponents : undefined,
    configFiles: generated.configFiles,
    decisionLog,
    runtimeEvents: [],
  };
}

export async function run(input: PaymentsGenInput): Promise<AgentResult<PaymentsGenOutput>> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const correlationId = parseCorrelationId(input);

  try {
    const data = await runImpl(input);
    const endedMs = Date.now();
    return {
      ok: true,
      agent: AGENT_NAME,
      startedAt,
      finishedAt: nowIso(),
      ms: msBetween(startedMs, endedMs),
      errors: [],
      data,
    };
  } catch (error) {
    const endedMs = Date.now();
    const { code, message } = toPaymentsGenError(error);
    const recovery = recoveryForError(code);
    const runtimeEvent = buildFailureEvent(correlationId, code, message, recovery.action);

    return {
      ok: false,
      agent: AGENT_NAME,
      startedAt,
      finishedAt: nowIso(),
      ms: msBetween(startedMs, endedMs),
      errors: [{ code, message }],
      data: {
        webhookHandlers: [],
        checkoutFiles: [],
        billingComponents: [],
        configFiles: [],
        decisionLog: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
