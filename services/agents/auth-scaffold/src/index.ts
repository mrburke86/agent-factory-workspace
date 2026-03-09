import path from "node:path";
import ts from "typescript";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  DecisionLogEntrySchema,
  EventEnvelopeSchema,
  GeneratedFileSchema,
  type DecisionLevel,
  type DecisionLogEntry,
  type EventEnvelope,
  type GeneratedFile,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "auth-scaffold";
const DEFAULT_OUTPUT_DIR = ".";

type AuthStrategy = "authjs" | "jwt";
type AuthProvider = "google" | "github" | "email";

type AuthScaffoldInput = {
  authSpec: {
    strategy: string;
    providers: string[];
    techStack: {
      language: string;
      framework: string;
    };
    ui?: {
      loginPage?: boolean;
      signupPage?: boolean;
    };
  };
  outputDir: string;
  correlationId?: string;
};

type AuthScaffoldRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type AuthScaffoldOutput = {
  configFiles: GeneratedFile[];
  routeFiles: GeneratedFile[];
  middlewareFiles: GeneratedFile[];
  componentFiles?: GeneratedFile[];
  decisionLog: DecisionLogEntry[];
  runtimeEvents: EventEnvelope[];
  recovery?: AuthScaffoldRecovery;
};

type ParsedInput = {
  strategy: AuthStrategy;
  providers: AuthProvider[];
  outputDir: string;
  includeLoginPage: boolean;
  includeSignupPage: boolean;
};

type AuthScaffoldErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class AuthScaffoldError extends Error {
  readonly code: AuthScaffoldErrorCode;

  constructor(code: AuthScaffoldErrorCode, message: string) {
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
    throw new AuthScaffoldError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new AuthScaffoldError("SCOPE_VIOLATION", `outputDir must be project-relative and non-escaping: ${outputDir}`);
  }

  if (normalizedFilePath.length === 0) {
    throw new AuthScaffoldError("INPUT_INVALID", "generated file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new AuthScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new AuthScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (normalizedOutputDir !== ".") {
    if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
      throw new AuthScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
    }
  }

  return resolvedPath;
}

function detectLanguage(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return "typescriptreact";
    case ".ts":
      return "typescript";
    case ".js":
      return "javascript";
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
    throw new AuthScaffoldError("INPUT_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeStrategy(raw: unknown): AuthStrategy {
  const value = assertNonEmptyString(raw, "authSpec.strategy").toLowerCase();
  if (value === "authjs" || value === "auth.js" || value === "nextauth" || value === "next-auth") {
    return "authjs";
  }
  if (value === "jwt" || value === "custom-jwt" || value === "custom_jwt") {
    return "jwt";
  }
  throw new AuthScaffoldError("INPUT_INVALID", `unsupported auth strategy: ${String(raw)}`);
}

function normalizeProvider(raw: unknown): AuthProvider {
  const value = assertNonEmptyString(raw, "authSpec.providers[]").toLowerCase();
  if (value === "google") return "google";
  if (value === "github") return "github";
  if (value === "email" || value === "email-password" || value === "email/password" || value === "password") return "email";
  throw new AuthScaffoldError("INPUT_INVALID", `unsupported auth provider: ${String(raw)}`);
}

function normalizeLanguage(raw: unknown): void {
  const value = assertNonEmptyString(raw, "authSpec.techStack.language").toLowerCase();
  if (value === "typescript" || value === "ts") return;
  throw new AuthScaffoldError("UNSUPPORTED_STACK", `unsupported language for auth-scaffold: ${String(raw)}`);
}

function normalizeFramework(raw: unknown): void {
  const value = assertNonEmptyString(raw, "authSpec.techStack.framework").toLowerCase();
  if (value === "next" || value === "nextjs" || value === "next.js" || value === "nextjs-app-router") return;
  throw new AuthScaffoldError("UNSUPPORTED_STACK", `unsupported framework for auth-scaffold: ${String(raw)}`);
}

function parseProviders(raw: unknown): AuthProvider[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AuthScaffoldError("INPUT_INVALID", "authSpec.providers must be a non-empty array");
  }

  const providers: AuthProvider[] = [];
  const seen = new Set<AuthProvider>();
  for (const entry of raw) {
    const provider = normalizeProvider(entry);
    if (!seen.has(provider)) {
      providers.push(provider);
      seen.add(provider);
    }
  }

  if (providers.length === 0) {
    throw new AuthScaffoldError("INPUT_INVALID", "authSpec.providers resolved to zero supported providers");
  }
  return providers;
}

function parseInput(input: AuthScaffoldInput): ParsedInput {
  if (!isObject(input)) {
    throw new AuthScaffoldError("INPUT_INVALID", "input must be an object");
  }

  if (!isObject(input.authSpec)) {
    throw new AuthScaffoldError("INPUT_INVALID", "authSpec must be an object");
  }

  const strategy = normalizeStrategy(input.authSpec.strategy);
  const providers = parseProviders(input.authSpec.providers);

  if (!isObject(input.authSpec.techStack)) {
    throw new AuthScaffoldError("INPUT_INVALID", "authSpec.techStack must be an object");
  }
  normalizeLanguage(input.authSpec.techStack.language);
  normalizeFramework(input.authSpec.techStack.framework);

  const outputDir = assertNonEmptyString(input.outputDir, "outputDir");
  const uiSpec = isObject(input.authSpec.ui) ? input.authSpec.ui : {};

  return {
    strategy,
    providers,
    outputDir,
    includeLoginPage: uiSpec.loginPage === true,
    includeSignupPage: uiSpec.signupPage === true,
  };
}

function buildProviderSetExpr(providers: AuthProvider[]): string {
  return providers.map((provider) => `"${provider}"`).join(", ");
}

function buildAuthJsConfigContent(providers: AuthProvider[]): string {
  const providerSet = new Set(providers);
  const enabledExpr = (provider: AuthProvider) => (providerSet.has(provider) ? "true" : "false");

  return [
    "// Generated by auth-scaffold (Auth.js strategy).",
    "// Compile-safe structural types; no next-auth import required.",
    "",
    "type AuthProviderId = \"google\" | \"github\" | \"email\";",
    "",
    "export type AuthSession = {",
    "  userId: string;",
    "  email?: string;",
    "  provider: AuthProviderId;",
    "  expiresAt: string;",
    "};",
    "",
    "type ProviderConfig = {",
    "  id: AuthProviderId;",
    "  enabled: boolean;",
    "  clientId?: string;",
    "  clientSecret?: string;",
    "  fromAddress?: string;",
    "};",
    "",
    "type AuthConfig = {",
    "  strategy: \"authjs\";",
    "  providers: ProviderConfig[];",
    "  callbacks: { session(session: AuthSession): AuthSession };",
    "};",
    "",
    "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};",
    "",
    "const providers: ProviderConfig[] = [];",
    "if (" + enabledExpr("google") + ") {",
    "  providers.push({ id: \"google\", enabled: true, clientId: runtimeEnv.GOOGLE_CLIENT_ID, clientSecret: runtimeEnv.GOOGLE_CLIENT_SECRET });",
    "}",
    "if (" + enabledExpr("github") + ") {",
    "  providers.push({ id: \"github\", enabled: true, clientId: runtimeEnv.GITHUB_CLIENT_ID, clientSecret: runtimeEnv.GITHUB_CLIENT_SECRET });",
    "}",
    "if (" + enabledExpr("email") + ") {",
    "  providers.push({ id: \"email\", enabled: true, fromAddress: runtimeEnv.EMAIL_FROM });",
    "}",
    "",
    "export const authConfig: AuthConfig = {",
    "  strategy: \"authjs\",",
    "  providers,",
    "  callbacks: {",
    "    session(session) {",
    "      return { ...session, provider: session.provider ?? \"email\" };",
    "    },",
    "  },",
    "};",
    "",
    "const providerAllowList = new Set<AuthProviderId>([" + buildProviderSetExpr(providers) + "]);",
    "",
    "export function parseSessionHeader(rawHeader: string | undefined): AuthSession | null {",
    "  if (!rawHeader || rawHeader.trim().length === 0) return null;",
    "  const parts = rawHeader.split(\"|\");",
    "  if (parts.length < 4) return null;",
    "  const provider = parts[2] as AuthProviderId;",
    "  if (!providerAllowList.has(provider)) return null;",
    "  return { userId: parts[0] ?? \"\", email: parts[1] || undefined, provider, expiresAt: parts[3] ?? \"\" };",
    "}",
    "",
  ].join("\n");
}

function buildAuthJsRouteContent(): string {
  return [
    "// Generated by auth-scaffold (Auth.js route scaffold).",
    "",
    "type AuthSession = { userId: string; email?: string; provider: \"google\" | \"github\" | \"email\"; expiresAt: string };",
    "const authConfig = { strategy: \"authjs\" as const, providers: [{ id: \"google\" }, { id: \"github\" }, { id: \"email\" }] };",
    "",
    "type NextRequest = { method: string; headers: Record<string, string | undefined> };",
    "type NextResponsePayload = { status: number; body: unknown };",
    "const NextResponse = { json(body: unknown, init?: { status?: number }): NextResponsePayload { return { status: init?.status ?? 200, body }; } };",
    "",
    "function parseSessionHeader(rawHeader: string | undefined): AuthSession | null {",
    "  if (!rawHeader || rawHeader.trim().length === 0) return null;",
    "  const parts = rawHeader.split(\"|\");",
    "  if (parts.length < 4) return null;",
    "  return {",
    "    userId: parts[0] ?? \"\",",
    "    email: parts[1] || undefined,",
    "    provider: (parts[2] as \"google\" | \"github\" | \"email\") ?? \"email\",",
    "    expiresAt: parts[3] ?? \"\",",
    "  };",
    "}",
    "",
    "function sessionFromRequest(request: NextRequest): AuthSession | null {",
    "  return parseSessionHeader(request.headers[\"x-session\"]);",
    "}",
    "",
    "async function handleAuthRequest(request: NextRequest): Promise<NextResponsePayload> {",
    "  const session = sessionFromRequest(request);",
    "  return NextResponse.json({",
    "    ok: true,",
    "    strategy: authConfig.strategy,",
    "    providers: authConfig.providers.map((provider) => provider.id),",
    "    sessionPresent: session !== null,",
    "    method: request.method,",
    "  });",
    "}",
    "",
    "export const GET = handleAuthRequest;",
    "export const POST = handleAuthRequest;",
    "",
  ].join("\n");
}

function buildJwtConfigContent(providers: AuthProvider[]): string {
  return [
    "// Generated by auth-scaffold (JWT strategy).",
    "",
    "type JwtProvider = \"google\" | \"github\" | \"email\";",
    "type JwtClaims = { sub: string; email?: string; provider: JwtProvider; exp: number };",
    "export type AuthSession = { userId: string; email?: string; provider: JwtProvider };",
    "",
    "const providerAllowList = new Set<JwtProvider>([" + buildProviderSetExpr(providers) + "]);",
    "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};",
    "",
    "function getJwtSecret(): string {",
    "  return runtimeEnv.AUTH_JWT_SECRET || \"development-only-secret\";",
    "}",
    "",
    "function encodeClaims(claims: JwtClaims): string {",
    "  return encodeURIComponent(JSON.stringify(claims));",
    "}",
    "",
    "function decodeClaims(encoded: string): JwtClaims | null {",
    "  try {",
    "    const parsed = JSON.parse(decodeURIComponent(encoded)) as JwtClaims;",
    "    if (typeof parsed.sub !== \"string\") return null;",
    "    if (typeof parsed.exp !== \"number\") return null;",
    "    if (!providerAllowList.has(parsed.provider)) return null;",
    "    return parsed;",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "",
    "export function issueJwtForUser(params: { userId: string; email?: string; provider: JwtProvider }): string {",
    "  if (!providerAllowList.has(params.provider)) {",
    "    throw new Error(\"Provider is not allowed by this auth configuration\");",
    "  }",
    "  const claims: JwtClaims = { sub: params.userId, email: params.email, provider: params.provider, exp: Date.now() + 1000 * 60 * 60 };",
    "  return `${getJwtSecret()}.${encodeClaims(claims)}`;",
    "}",
    "",
    "export function verifyJwtToken(token: string): AuthSession | null {",
    "  const parts = token.split(\".\");",
    "  if (parts.length < 2) return null;",
    "  if ((parts[0] ?? \"\") !== getJwtSecret()) return null;",
    "  const claims = decodeClaims(parts.slice(1).join(\".\"));",
    "  if (!claims || claims.exp <= Date.now()) return null;",
    "  return { userId: claims.sub, email: claims.email, provider: claims.provider };",
    "}",
    "",
    "export function verifyJwtFromHeader(rawHeader: string | undefined): AuthSession | null {",
    "  if (!rawHeader || rawHeader.trim().length === 0) return null;",
    "  const token = rawHeader.replace(/^Bearer\\s+/i, \"\").trim();",
    "  if (token.length === 0) return null;",
    "  return verifyJwtToken(token);",
    "}",
    "",
  ].join("\n");
}

function buildJwtRouteContent(): string {
  return [
    "// Generated by auth-scaffold (JWT token route scaffold).",
    "",
    "type NextRequest = { method: string; json(): Promise<unknown> };",
    "type NextResponsePayload = { status: number; body: unknown };",
    "const NextResponse = { json(body: unknown, init?: { status?: number }): NextResponsePayload { return { status: init?.status ?? 200, body }; } };",
    "const secret = \"development-only-secret\";",
    "",
    "function issueJwtForUser(params: { userId: string; email?: string; provider: \"google\" | \"github\" | \"email\" }): string {",
    "  const claims = encodeURIComponent(JSON.stringify({ sub: params.userId, email: params.email, provider: params.provider, exp: Date.now() + 1000 * 60 * 60 }));",
    "  return `${secret}.${claims}`;",
    "}",
    "",
    "function parseRequestBody(raw: unknown): { userId: string; email?: string; provider: \"google\" | \"github\" | \"email\" } | null {",
    "  if (!raw || typeof raw !== \"object\" || Array.isArray(raw)) return null;",
    "  const body = raw as Record<string, unknown>;",
    "  if (typeof body.userId !== \"string\" || body.userId.trim().length === 0) return null;",
    "  if (body.email !== undefined && typeof body.email !== \"string\") return null;",
    "  if (body.provider !== \"google\" && body.provider !== \"github\" && body.provider !== \"email\") return null;",
    "  return { userId: body.userId.trim(), email: body.email as string | undefined, provider: body.provider };",
    "}",
    "",
    "export async function POST(request: NextRequest): Promise<NextResponsePayload> {",
    "  const parsed = parseRequestBody(await request.json());",
    "  if (!parsed) return NextResponse.json({ ok: false, error: \"Invalid token request payload\" }, { status: 400 });",
    "  const token = issueJwtForUser(parsed);",
    "  return NextResponse.json({ ok: true, token }, { status: 201 });",
    "}",
    "",
    "export async function GET(): Promise<NextResponsePayload> {",
    "  return NextResponse.json({ ok: true, strategy: \"jwt\" });",
    "}",
    "",
  ].join("\n");
}

function buildAuthJsMiddlewareContent(): string {
  return [
    "// Generated by auth-scaffold (Auth.js middleware scaffold).",
    "",
    "type RequestLike = { pathname: string; headers: Record<string, string | undefined> };",
    "type MiddlewareResult = { allow: boolean; redirectTo?: string };",
    "const PUBLIC_PATH_PREFIXES = [\"/\", \"/login\", \"/signup\", \"/api/auth\"];",
    "",
    "function hasSession(header: string | undefined): boolean {",
    "  return typeof header === \"string\" && header.trim().split(\"|\").length >= 4;",
    "}",
    "",
    "export function authMiddleware(request: RequestLike): MiddlewareResult {",
    "  if (PUBLIC_PATH_PREFIXES.some((prefix) => request.pathname === prefix || request.pathname.startsWith(`${prefix}/`))) {",
    "    return { allow: true };",
    "  }",
    "  if (!hasSession(request.headers[\"x-session\"])) return { allow: false, redirectTo: \"/login\" };",
    "  return { allow: true };",
    "}",
    "",
    "export const config = { matcher: [\"/((?!_next/static|_next/image|favicon.ico).*)\"] };",
    "",
  ].join("\n");
}

function buildJwtMiddlewareContent(): string {
  return [
    "// Generated by auth-scaffold (JWT middleware scaffold).",
    "",
    "type RequestLike = { pathname: string; headers: Record<string, string | undefined> };",
    "type MiddlewareResult = { allow: boolean; redirectTo?: string };",
    "const PUBLIC_PATH_PREFIXES = [\"/\", \"/login\", \"/signup\", \"/api/auth/token\"];",
    "",
    "function verifyJwtFromHeader(header: string | undefined): boolean {",
    "  if (!header || header.trim().length === 0) return false;",
    "  const token = header.replace(/^Bearer\\s+/i, \"\").trim();",
    "  return token.split(\".\").length >= 2;",
    "}",
    "",
    "export function authMiddleware(request: RequestLike): MiddlewareResult {",
    "  if (PUBLIC_PATH_PREFIXES.some((prefix) => request.pathname === prefix || request.pathname.startsWith(`${prefix}/`))) {",
    "    return { allow: true };",
    "  }",
    "  const session = verifyJwtFromHeader(request.headers.authorization);",
    "  if (!session) return { allow: false, redirectTo: \"/login\" };",
    "  return { allow: true };",
    "}",
    "",
    "export const config = { matcher: [\"/((?!_next/static|_next/image|favicon.ico).*)\"] };",
    "",
  ].join("\n");
}

function buildProtectedWrapperContent(): string {
  return [
    "// Generated by auth-scaffold: compile-safe protected route wrapper (HOC).",
    "",
    "type ViewComponent<P> = (props: P) => unknown;",
    "",
    "export type GuardedProps = {",
    "  isAuthenticated: boolean;",
    "  fallback?: unknown;",
    "};",
    "",
    "export function withAuth<P extends object>(view: ViewComponent<P>): ViewComponent<P & GuardedProps> {",
    "  return function GuardedView(props: P & GuardedProps): unknown {",
    "    if (!props.isAuthenticated) return props.fallback ?? \"Authentication required\";",
    "    return view(props);",
    "  };",
    "}",
    "",
  ].join("\n");
}

function buildLoginPageContent(strategy: AuthStrategy): string {
  return [
    `// Generated by auth-scaffold: login page for ${strategy} strategy.`,
    "",
    "export function renderLoginPage(): string {",
    "  return [",
    "    \"<main aria-label='Login page'>\",",
    "    \"  <h1>Sign in</h1>\",",
    "    \"  <form aria-label='Login form'>\",",
    "    \"    <label for='email'>Email</label>\",",
    "    \"    <input id='email' name='email' type='email' />\",",
    "    \"    <button type='submit'>Continue</button>\",",
    "    \"  </form>\",",
    "    \"</main>\",",
    "  ].join(\"\\n\");",
    "}",
    "",
    "export default renderLoginPage;",
    "",
  ].join("\n");
}

function buildSignupPageContent(strategy: AuthStrategy): string {
  return [
    `// Generated by auth-scaffold: signup page for ${strategy} strategy.`,
    "",
    "export function renderSignupPage(): string {",
    "  return [",
    "    \"<main aria-label='Signup page'>\",",
    "    \"  <h1>Create account</h1>\",",
    "    \"  <form aria-label='Signup form'>\",",
    "    \"    <label for='signup-email'>Email</label>\",",
    "    \"    <input id='signup-email' name='email' type='email' />\",",
    "    \"    <label for='password'>Password</label>\",",
    "    \"    <input id='password' name='password' type='password' />\",",
    "    \"    <button type='submit'>Create account</button>\",",
    "    \"  </form>\",",
    "    \"</main>\",",
    "  ].join(\"\\n\");",
    "}",
    "",
    "export default renderSignupPage;",
    "",
  ].join("\n");
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
  return [
    createDecisionLogEntry({
      key: "auth-strategy",
      level: humanRequiredLevel,
      summary: "Authentication strategy selected",
      rationale: "Auth strategy changes security model and session behavior, so this is human-required.",
      selectedOption: input.strategy,
      alternatives: ["authjs", "jwt"],
    }),
    createDecisionLogEntry({
      key: "auth-providers",
      level: humanRequiredLevel,
      summary: "Authentication providers selected",
      rationale: "Provider choice affects onboarding, identity proofing, and compliance obligations.",
      selectedOption: input.providers.join(","),
      alternatives: ["google", "github", "email"],
    }),
  ];
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
  if (tsFiles.length === 0) return;

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
      if (virtual) return virtual.content;
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
  if (diagnostics.length === 0) return;

  const diagnosticMessages = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, virtualToGeneratedPath));
  throw new AuthScaffoldError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript/TSX did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function buildGeneratedFiles(input: ParsedInput): {
  configFiles: GeneratedFile[];
  routeFiles: GeneratedFile[];
  middlewareFiles: GeneratedFile[];
  componentFiles: GeneratedFile[];
} {
  const configFiles: GeneratedFile[] = [];
  const routeFiles: GeneratedFile[] = [];
  const middlewareFiles: GeneratedFile[] = [];
  const componentFiles: GeneratedFile[] = [];

  if (input.strategy === "authjs") {
    configFiles.push(createGeneratedFile(input.outputDir, "src/auth/auth.ts", buildAuthJsConfigContent(input.providers)));
    routeFiles.push(createGeneratedFile(input.outputDir, "src/app/api/auth/[...nextauth]/route.ts", buildAuthJsRouteContent()));
    middlewareFiles.push(createGeneratedFile(input.outputDir, "src/middleware.ts", buildAuthJsMiddlewareContent()));
  } else {
    configFiles.push(createGeneratedFile(input.outputDir, "src/auth/jwt.ts", buildJwtConfigContent(input.providers)));
    routeFiles.push(createGeneratedFile(input.outputDir, "src/app/api/auth/token/route.ts", buildJwtRouteContent()));
    middlewareFiles.push(createGeneratedFile(input.outputDir, "src/middleware.ts", buildJwtMiddlewareContent()));
  }

  componentFiles.push(createGeneratedFile(input.outputDir, "src/components/auth/withAuth.ts", buildProtectedWrapperContent()));

  if (input.includeLoginPage) {
    componentFiles.push(createGeneratedFile(input.outputDir, "src/app/login/page.ts", buildLoginPageContent(input.strategy)));
  }
  if (input.includeSignupPage) {
    componentFiles.push(createGeneratedFile(input.outputDir, "src/app/signup/page.ts", buildSignupPageContent(input.strategy)));
  }

  const allFiles = [...configFiles, ...routeFiles, ...middlewareFiles, ...componentFiles];
  if (allFiles.length === 0) {
    throw new AuthScaffoldError("GENERATION_FAILED", "auth scaffolding generated no files");
  }

  const seen = new Set<string>();
  for (const file of allFiles) {
    if (seen.has(file.path)) {
      throw new AuthScaffoldError("INPUT_INVALID", `duplicate generated path: ${file.path}`);
    }
    seen.add(file.path);
  }

  validateTypeScriptCompilation(allFiles);

  return {
    configFiles,
    routeFiles,
    middlewareFiles,
    componentFiles,
  };
}

function recoveryForError(code: AuthScaffoldErrorCode): AuthScaffoldRecovery {
  if (code === "INPUT_INVALID" || code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Auth scaffold input or output scope is invalid; retry with schema-compliant values.",
    };
  }
  if (code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated auth files failed TypeScript noEmit validation; retry with compile-safe scaffolding.",
    };
  }
  if (code === "UNSUPPORTED_STACK") {
    return {
      action: "escalate",
      rationale: "Auth scaffold currently supports TypeScript on Next.js; escalate unsupported stack decisions.",
    };
  }
  return {
    action: "escalate",
    rationale: "Unexpected auth-scaffold failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: AuthScaffoldErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "auth-scaffold.failed",
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

function toAuthScaffoldError(error: unknown): { code: AuthScaffoldErrorCode; message: string } {
  if (error instanceof AuthScaffoldError) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      code: "GENERATION_FAILED",
      message: error.message,
    };
  }
  return {
    code: "GENERATION_FAILED",
    message: String(error),
  };
}

async function runImpl(input: AuthScaffoldInput): Promise<AuthScaffoldOutput> {
  const parsedInput = parseInput(input);
  const decisionLog = buildDecisionLog(parsedInput);
  const generated = buildGeneratedFiles(parsedInput);

  return {
    configFiles: generated.configFiles,
    routeFiles: generated.routeFiles,
    middlewareFiles: generated.middlewareFiles,
    componentFiles: generated.componentFiles.length > 0 ? generated.componentFiles : undefined,
    decisionLog,
    runtimeEvents: [],
  };
}

export async function run(input: AuthScaffoldInput): Promise<AgentResult<AuthScaffoldOutput>> {
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
    const { code, message } = toAuthScaffoldError(error);
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
        configFiles: [],
        routeFiles: [],
        middlewareFiles: [],
        componentFiles: [],
        decisionLog: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
