import path from "node:path";
import ts from "typescript";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  EventEnvelopeSchema,
  GeneratedFileSchema,
  type EventEnvelope,
  type GeneratedFile,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "api-gen";
const DEFAULT_FRAMEWORK = "nextjs-app-router";

type FrameworkKind = "nextjs-app-router" | "express";
type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  required?: string[];
  nullable?: boolean;
};

type RouteSpec = {
  method: RouteMethod;
  path: string;
  purpose: string;
  auth: boolean;
  inputSchema?: JsonSchemaLike;
  outputSchema?: JsonSchemaLike;
};

type SchemaRef = {
  name?: string;
  path?: string;
};

type ApiGenInput = {
  routes: RouteSpec[];
  techStack: {
    framework?: FrameworkKind;
  };
  schemaRefs?: SchemaRef[];
  outputDir: string;
  correlationId?: string;
};

type ApiGenRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type ApiGenOutput = {
  routeFiles: GeneratedFile[];
  middlewareFiles?: GeneratedFile[];
  runtimeEvents: EventEnvelope[];
  recovery?: ApiGenRecovery;
};

type ParsedInput = {
  routes: RouteSpec[];
  framework: FrameworkKind;
  schemaRefs: SchemaRef[];
  outputDir: string;
};

type ApiGenErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class ApiGenError extends Error {
  readonly code: ApiGenErrorCode;

  constructor(code: ApiGenErrorCode, message: string) {
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
  const normalizedOutputDir = path.posix.normalize(normalizeSlashes(outputDir.trim()));
  const normalizedFilePath = path.posix.normalize(normalizeSlashes(filePath.trim()));

  if (normalizedOutputDir.length === 0) {
    throw new ApiGenError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new ApiGenError("SCOPE_VIOLATION", `outputDir must be project-relative and non-escaping: ${outputDir}`);
  }

  if (normalizedFilePath.length === 0) {
    throw new ApiGenError("INPUT_INVALID", "generated file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new ApiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new ApiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (normalizedOutputDir !== ".") {
    if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
      throw new ApiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
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
    case ".js":
      return "javascript";
    case ".json":
      return "json";
    default:
      return "plaintext";
  }
}

function toIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length === 0) return "route";
  if (/^[0-9]/.test(normalized)) return `route_${normalized}`;
  return normalized;
}

function toPascalCase(value: string): string {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) return "Route";
  return parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : "route";
}

function toNextSegment(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.startsWith(":")) {
    return `[${sanitizeSegment(trimmed.slice(1))}]`;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.length > 2) {
    return `[${sanitizeSegment(trimmed.slice(1, -1))}]`;
  }
  return sanitizeSegment(trimmed);
}

function splitRoutePath(routePath: string): string[] {
  const withoutQuery = routePath.split("?")[0] ?? routePath;
  return withoutQuery
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function routeMethod(raw: unknown): RouteMethod {
  if (typeof raw !== "string") {
    throw new ApiGenError("INPUT_INVALID", "route.method must be a string");
  }

  const upper = raw.trim().toUpperCase();
  if (upper === "GET" || upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE") {
    return upper;
  }

  throw new ApiGenError("INPUT_INVALID", `unsupported route method: ${raw}`);
}

function acceptsBody(method: RouteMethod): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiGenError("INPUT_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseSchema(value: unknown): JsonSchemaLike | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw new ApiGenError("INPUT_INVALID", "schema values must be objects when provided");
  }
  return value as JsonSchemaLike;
}

function parseRoute(value: unknown): RouteSpec {
  if (!isObject(value)) {
    throw new ApiGenError("INPUT_INVALID", "each route must be an object");
  }

  return {
    method: routeMethod(value.method),
    path: assertNonEmptyString(value.path, "route.path"),
    purpose: assertNonEmptyString(value.purpose, "route.purpose"),
    auth: value.auth === true,
    inputSchema: parseSchema(value.inputSchema),
    outputSchema: parseSchema(value.outputSchema),
  };
}

function parseSchemaRefs(value: unknown): SchemaRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiGenError("INPUT_INVALID", "schemaRefs must be an array when provided");
  }

  return value.map((item) => {
    if (!isObject(item)) {
      throw new ApiGenError("INPUT_INVALID", "each schemaRef must be an object");
    }
    return {
      name: typeof item.name === "string" ? item.name : undefined,
      path: typeof item.path === "string" ? item.path : undefined,
    };
  });
}

function parseInput(input: ApiGenInput): ParsedInput {
  if (!isObject(input)) {
    throw new ApiGenError("INPUT_INVALID", "input must be an object");
  }

  const routesRaw = input.routes;
  if (!Array.isArray(routesRaw) || routesRaw.length === 0) {
    throw new ApiGenError("INPUT_INVALID", "routes must contain at least one route specification");
  }

  const routes = routesRaw.map(parseRoute);

  const outputDir = assertNonEmptyString(input.outputDir, "outputDir");

  const frameworkRaw = input.techStack?.framework ?? DEFAULT_FRAMEWORK;
  if (frameworkRaw !== "nextjs-app-router" && frameworkRaw !== "express") {
    throw new ApiGenError("UNSUPPORTED_STACK", `unsupported framework: ${String(frameworkRaw)}`);
  }

  const schemaRefs = parseSchemaRefs(input.schemaRefs);

  const uniqueness = new Set<string>();
  for (const route of routes) {
    const key = `${route.method}:${route.path}`;
    if (uniqueness.has(key)) {
      throw new ApiGenError("INPUT_INVALID", `duplicate route detected: ${key}`);
    }
    uniqueness.add(key);
  }

  return {
    routes,
    framework: frameworkRaw,
    schemaRefs,
    outputDir,
  };
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
  const typeScriptFiles = files.filter((file) => file.language === "typescript" || file.language === "typescriptreact");
  if (typeScriptFiles.length === 0) {
    return;
  }

  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const virtualContents = new Map<string, { content: string; scriptKind: ts.ScriptKind }>();
  const virtualToGeneratedPath = new Map<string, string>();

  for (const file of typeScriptFiles) {
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
  if (diagnostics.length === 0) {
    return;
  }

  const diagnosticMessages = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, virtualToGeneratedPath));
  throw new ApiGenError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function toTypeScriptType(schema: JsonSchemaLike | undefined, depth = 0): string {
  if (!schema || depth > 6) return "unknown";

  const baseType = schema.type?.toLowerCase();
  if (!baseType) return "unknown";

  let inferred: string;
  if (baseType === "string") {
    inferred = "string";
  } else if (baseType === "number" || baseType === "integer") {
    inferred = "number";
  } else if (baseType === "boolean") {
    inferred = "boolean";
  } else if (baseType === "array") {
    inferred = `${toTypeScriptType(schema.items, depth + 1)}[]`;
  } else if (baseType === "object") {
    const props = schema.properties ?? {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const entries = Object.entries(props);

    if (entries.length === 0) {
      inferred = "Record<string, unknown>";
    } else {
      const members = entries.map(([key, value]) => {
        const optional = required.has(key) ? "" : "?";
        return `${JSON.stringify(key)}${optional}: ${toTypeScriptType(value, depth + 1)}`;
      });
      inferred = `{ ${members.join("; ")} }`;
    }
  } else {
    inferred = "unknown";
  }

  return schema.nullable ? `${inferred} | null` : inferred;
}

function schemaToZodExpression(schema: JsonSchemaLike | undefined, required = true, depth = 0): string {
  if (!schema || depth > 6) {
    return required ? "z.any()" : "z.any().optional()";
  }

  const kind = schema.type?.toLowerCase();
  let expression: string;

  if (kind === "string") {
    expression = "z.string()";
  } else if (kind === "number" || kind === "integer") {
    expression = "z.number()";
  } else if (kind === "boolean") {
    expression = "z.boolean()";
  } else if (kind === "array") {
    expression = `z.array(${schemaToZodExpression(schema.items, true, depth + 1)})`;
  } else if (kind === "object") {
    const props = schema.properties ?? {};
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    const propertyEntries = Object.entries(props).map(([key, value]) => {
      const propRequired = requiredSet.has(key);
      return `${JSON.stringify(key)}: ${schemaToZodExpression(value, propRequired, depth + 1)}`;
    });
    expression = `z.object({${propertyEntries.join(", ")}})`;
  } else {
    expression = "z.any()";
  }

  if (schema.nullable) {
    expression = `${expression}.nullable()`;
  }

  if (!required) {
    expression = `${expression}.optional()`;
  }

  return expression;
}

function renderSchemaRefsComment(schemaRefs: SchemaRef[]): string {
  if (schemaRefs.length === 0) {
    return "// schemaRefs: none";
  }

  const rendered = schemaRefs
    .map((ref) => `${ref.name?.trim() || "ref"}:${ref.path?.trim() || "unknown"}`)
    .join(", ");
  return `// schemaRefs: ${rendered}`;
}

function buildSharedValidationStubLines(): string[] {
  return [
    "type ParseResult<T> = { success: true; data: T } | { success: false; error: { message: string } };",
    "type ZodLike<T = unknown> = {",
    "  safeParse(value: unknown): ParseResult<T>;",
    "  optional(): ZodLike<T | undefined>;",
    "  nullable(): ZodLike<T | null>;",
    "};",
    "",
    "function createSchema<T>(safeParse: (value: unknown) => ParseResult<T>): ZodLike<T> {",
    "  return {",
    "    safeParse,",
    "    optional() {",
    "      return createSchema<T | undefined>((value) => (value === undefined ? { success: true, data: undefined } : safeParse(value) as ParseResult<T | undefined>));",
    "    },",
    "    nullable() {",
    "      return createSchema<T | null>((value) => (value === null ? { success: true, data: null } : safeParse(value) as ParseResult<T | null>));",
    "    },",
    "  };",
    "}",
    "",
    "const z = {",
    "  any: () => createSchema<unknown>((value) => ({ success: true, data: value })),",
    "  string: () => createSchema<string>((value) => (typeof value === \"string\" ? { success: true, data: value } : { success: false, error: { message: \"expected string\" } })),",
    "  number: () => createSchema<number>((value) => (typeof value === \"number\" ? { success: true, data: value } : { success: false, error: { message: \"expected number\" } })),",
    "  boolean: () => createSchema<boolean>((value) => (typeof value === \"boolean\" ? { success: true, data: value } : { success: false, error: { message: \"expected boolean\" } })),",
    "  array: <T>(item: ZodLike<T>) => createSchema<T[]>((value) => {",
    "    if (!Array.isArray(value)) return { success: false, error: { message: \"expected array\" } };",
    "    const parsed: T[] = [];",
    "    for (const entry of value) {",
    "      const result = item.safeParse(entry);",
    "      if (!result.success) return { success: false, error: result.error };",
    "      parsed.push(result.data);",
    "    }",
    "    return { success: true, data: parsed };",
    "  }),",
    "  object: (shape: Record<string, ZodLike>) => createSchema<Record<string, unknown>>((value) => {",
    "    if (!value || typeof value !== \"object\" || Array.isArray(value)) return { success: false, error: { message: \"expected object\" } };",
    "    const src = value as Record<string, unknown>;",
    "    const parsed: Record<string, unknown> = {};",
    "    for (const [key, schema] of Object.entries(shape)) {",
    "      const result = schema.safeParse(src[key]);",
    "      if (!result.success) return { success: false, error: { message: `${key}: ${result.error.message}` } };",
    "      parsed[key] = result.data;",
    "    }",
    "    return { success: true, data: parsed };",
    "  }),",
    "};",
    "",
  ];
}

function buildNextRouteFile(route: RouteSpec, schemaRefs: SchemaRef[]): { relativePath: string; content: string } {
  const segments = splitRoutePath(route.path).map(toNextSegment);
  const relativePath = segments.length > 0 ? `app/${segments.join("/")}/route.ts` : "app/route.ts";
  const inputSchemaExpr = schemaToZodExpression(route.inputSchema, true);
  const outputType = toTypeScriptType(route.outputSchema);
  const requiresValidation = !!route.inputSchema || acceptsBody(route.method);

  const lines: string[] = [
    `// Generated by ${AGENT_NAME}: ${route.purpose}.`,
    renderSchemaRefsComment(schemaRefs),
    "// Strategy B: structural type stubs for Next.js route handlers (no next dependency required).",
    "",
    ...buildSharedValidationStubLines(),
    "type NextRequest = { method: string; headers: Record<string, string | undefined>; json(): Promise<unknown> };",
    "type NextResponsePayload = { status: number; body: unknown };",
    "",
    "const NextResponse = {",
    "  json(body: unknown, init?: { status?: number }): NextResponsePayload {",
    "    return { status: init?.status ?? 200, body };",
    "  },",
    "};",
    "",
    "type ApiSuccess<T> = { ok: true; data: T };",
    "type ApiFailure = { ok: false; error: string };",
    "",
    "function jsonError(status: number, message: string): NextResponsePayload {",
    "  return NextResponse.json({ ok: false, error: message } satisfies ApiFailure, { status });",
    "}",
    "",
    "function jsonOk<T>(data: T, status = 200): NextResponsePayload {",
    "  return NextResponse.json({ ok: true, data } satisfies ApiSuccess<T>, { status });",
    "}",
    "",
  ];

  if (route.auth) {
    lines.push("type Session = { userId: string };");
    lines.push("async function getServerSession(): Promise<Session | null> {");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
  }

  lines.push(`const InputSchema = ${inputSchemaExpr};`);
  lines.push(`type RouteOutput = ${outputType};`);
  lines.push("");
  lines.push(`export async function ${route.method}(request: NextRequest): Promise<NextResponsePayload> {`);
  lines.push("  try {");

  if (route.auth) {
    lines.push("    const session = await getServerSession();");
    lines.push("    if (!session) {");
    lines.push("      return jsonError(401, \"Unauthorized\");");
    lines.push("    }");
    lines.push("");
  }

  if (requiresValidation) {
    if (acceptsBody(route.method)) {
      lines.push("    const rawInput = await request.json();");
    } else {
      lines.push("    const rawInput = {}; // query/path validation scaffold");
    }
    lines.push("    const parsedInput = InputSchema.safeParse(rawInput);");
    lines.push("    if (!parsedInput.success) {");
    lines.push("      return jsonError(400, parsedInput.error.message);");
    lines.push("    }");
    lines.push("");
  }

  lines.push("    const response = ({ message: \"ok\" } as unknown) as RouteOutput;");
  lines.push(`    return jsonOk<RouteOutput>(response, ${route.method === "POST" ? "201" : "200"});`);
  lines.push("  } catch {");
  lines.push("    return jsonError(500, \"Internal Server Error\");");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return {
    relativePath,
    content: lines.join("\n"),
  };
}

function buildExpressRouteFile(route: RouteSpec, schemaRefs: SchemaRef[]): { relativePath: string; content: string } {
  const segments = splitRoutePath(route.path).map(sanitizeSegment);
  const routeKey = segments.length > 0 ? segments.join("-") : "root";
  const relativePath = `express/routes/${route.method.toLowerCase()}-${routeKey}.ts`;
  const inputSchemaExpr = schemaToZodExpression(route.inputSchema, true);
  const outputType = toTypeScriptType(route.outputSchema);
  const handlerName = `handle${route.method}${toPascalCase(routeKey)}`;
  const requiresValidation = !!route.inputSchema || acceptsBody(route.method);

  const lines: string[] = [
    `// Generated by ${AGENT_NAME}: ${route.purpose}.`,
    renderSchemaRefsComment(schemaRefs),
    "",
    ...buildSharedValidationStubLines(),
    "type ExpressRequest = { method: string; body?: unknown; headers: Record<string, string | undefined> };",
    "type ExpressResponse = { status(code: number): ExpressResponse; json(body: unknown): void };",
    "",
    "type ApiSuccess<T> = { ok: true; data: T };",
    "type ApiFailure = { ok: false; error: string };",
    "",
    "function sendError(res: ExpressResponse, status: number, message: string): void {",
    "  res.status(status).json({ ok: false, error: message } satisfies ApiFailure);",
    "}",
    "",
    "function sendOk<T>(res: ExpressResponse, data: T, status = 200): void {",
    "  res.status(status).json({ ok: true, data } satisfies ApiSuccess<T>);",
    "}",
    "",
  ];

  if (route.auth) {
    lines.push("type Session = { userId: string };");
    lines.push("async function getSessionFromRequest(_req: ExpressRequest): Promise<Session | null> {");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
  }

  lines.push(`const InputSchema = ${inputSchemaExpr};`);
  lines.push(`type RouteOutput = ${outputType};`);
  lines.push("");
  lines.push(`export async function ${handlerName}(req: ExpressRequest, res: ExpressResponse): Promise<void> {`);

  if (route.auth) {
    lines.push("  const session = await getSessionFromRequest(req);");
    lines.push("  if (!session) {");
    lines.push("    sendError(res, 401, \"Unauthorized\");");
    lines.push("    return;");
    lines.push("  }");
    lines.push("");
  }

  if (requiresValidation) {
    if (acceptsBody(route.method)) {
      lines.push("  const parsedInput = InputSchema.safeParse(req.body ?? {});");
    } else {
      lines.push("  const parsedInput = InputSchema.safeParse({});");
    }
    lines.push("  if (!parsedInput.success) {");
    lines.push("    sendError(res, 400, parsedInput.error.message);");
    lines.push("    return;");
    lines.push("  }");
    lines.push("");
  }

  lines.push("  const response = ({ message: \"ok\" } as unknown) as RouteOutput;");
  lines.push(`  sendOk<RouteOutput>(res, response, ${route.method === "POST" ? "201" : "200"});`);
  lines.push("}");
  lines.push("");

  return {
    relativePath,
    content: lines.join("\n"),
  };
}

function createGeneratedFile(outputDir: string, relativePath: string, content: string): GeneratedFile {
  const resolvedPath = resolveOutputPath(outputDir, relativePath);
  const language = detectLanguage(resolvedPath);
  return GeneratedFileSchema.parse({
    path: resolvedPath,
    content,
    language,
  });
}

function buildGeneratedFiles(input: ParsedInput): { routeFiles: GeneratedFile[]; middlewareFiles: GeneratedFile[] } {
  const routeFiles: GeneratedFile[] = [];
  const middlewareFiles: GeneratedFile[] = [];

  for (const route of input.routes) {
    const generated =
      input.framework === "nextjs-app-router"
        ? buildNextRouteFile(route, input.schemaRefs)
        : buildExpressRouteFile(route, input.schemaRefs);

    routeFiles.push(createGeneratedFile(input.outputDir, generated.relativePath, generated.content));
  }

  const uniquePaths = new Set<string>();
  for (const file of routeFiles) {
    if (uniquePaths.has(file.path)) {
      throw new ApiGenError("INPUT_INVALID", `multiple routes generated the same output path: ${file.path}`);
    }
    uniquePaths.add(file.path);
  }

  if (routeFiles.length === 0) {
    throw new ApiGenError("GENERATION_FAILED", "route generation produced no files");
  }

  return {
    routeFiles,
    middlewareFiles,
  };
}

function recoveryForError(code: ApiGenErrorCode): ApiGenRecovery {
  if (code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Generated paths must stay inside outputDir; retry with corrected relative route paths.",
    };
  }

  if (code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated route files failed TypeScript noEmit validation; retry with compile-safe handlers.",
    };
  }

  if (code === "INPUT_INVALID") {
    return {
      action: "retry_modified",
      rationale: "Route specification payload is invalid; retry with a schema-compliant input.",
    };
  }

  if (code === "UNSUPPORTED_STACK") {
    return {
      action: "escalate",
      rationale: "Requested framework is unsupported; escalate framework selection to operator.",
    };
  }

  return {
    action: "escalate",
    rationale: "Unexpected api-gen failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: ApiGenErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "api-gen.failed",
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

function toApiGenError(error: unknown): { code: ApiGenErrorCode; message: string } {
  if (error instanceof ApiGenError) {
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

async function runImpl(input: ApiGenInput): Promise<ApiGenOutput> {
  const parsedInput = parseInput(input);
  const generated = buildGeneratedFiles(parsedInput);
  validateTypeScriptCompilation([...generated.routeFiles, ...generated.middlewareFiles]);

  return {
    routeFiles: generated.routeFiles,
    middlewareFiles: generated.middlewareFiles.length > 0 ? generated.middlewareFiles : undefined,
    runtimeEvents: [],
  };
}

export async function run(input: ApiGenInput): Promise<AgentResult<ApiGenOutput>> {
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
    const { code, message } = toApiGenError(error);
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
        routeFiles: [],
        middlewareFiles: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
