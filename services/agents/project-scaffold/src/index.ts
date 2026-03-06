import path from "node:path";
import ts from "typescript";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  EventEnvelopeSchema,
  FileSpecSchema,
  GeneratedFileSchema,
  Layer2ConfigSchema,
  type EventEnvelope,
  type FileSpec,
  type GeneratedFile,
  type Layer2Config,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "project-scaffold";

type ProjectScaffoldInput = {
  l2Config: Layer2Config;
  outputDir: string;
  correlationId?: string;
};

type ProjectScaffoldRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type ProjectScaffoldOutput = {
  scaffoldedFiles: GeneratedFile[];
  runtimeEvents: EventEnvelope[];
  recovery?: ProjectScaffoldRecovery;
};

type ProjectScaffoldErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class ProjectScaffoldError extends Error {
  readonly code: ProjectScaffoldErrorCode;

  constructor(code: ProjectScaffoldErrorCode, message: string) {
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
    throw new ProjectScaffoldError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new ProjectScaffoldError(
      "SCOPE_VIOLATION",
      `outputDir must be project-relative and non-escaping: ${outputDir}`,
    );
  }

  if (normalizedFilePath.length === 0) {
    throw new ProjectScaffoldError("INPUT_INVALID", "file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new ProjectScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new ProjectScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
    throw new ProjectScaffoldError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
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
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".yml":
    case ".yaml":
      return "yaml";
    default:
      return "plaintext";
  }
}

function normalizeLanguage(language: string): "typescript" | "javascript" {
  const normalized = language.trim().toLowerCase();
  if (normalized === "typescript" || normalized === "ts") {
    return "typescript";
  }
  if (normalized === "javascript" || normalized === "js") {
    return "javascript";
  }
  throw new ProjectScaffoldError("UNSUPPORTED_STACK", `unsupported language for scaffolding: ${language}`);
}

function normalizeFramework(framework: string): "nextjs" {
  const normalized = framework.trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "next" || normalized === "nextjs" || normalized === "next.js") {
    return "nextjs";
  }
  throw new ProjectScaffoldError("UNSUPPORTED_STACK", `unsupported framework for scaffolding: ${framework}`);
}

function sanitizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized.length > 0 ? normalized : "scaffolded-app";
}

function inferOrm(l2Config: Layer2Config): "drizzle" | "prisma" | null {
  const haystack = JSON.stringify(l2Config.stages).toLowerCase();
  if (haystack.includes("drizzle")) return "drizzle";
  if (haystack.includes("prisma")) return "prisma";
  return null;
}

function buildPackageJson(l2Config: Layer2Config, language: "typescript" | "javascript"): string {
  const dependencies: Record<string, string> = {
    next: "14.2.5",
    react: "18.3.1",
    "react-dom": "18.3.1",
  };
  const devDependencies: Record<string, string> = {};

  const database = l2Config.techStack.database?.trim().toLowerCase();
  const auth = l2Config.techStack.auth?.trim().toLowerCase();
  const payments = l2Config.techStack.payments?.trim().toLowerCase();
  const orm = inferOrm(l2Config);

  if (database === "postgres" || database === "postgresql") {
    dependencies.pg = "^8.12.0";
  }
  if (database === "sqlite") {
    dependencies["better-sqlite3"] = "^11.1.2";
  }
  if (auth === "authjs" || auth === "nextauth" || auth === "next-auth") {
    dependencies["next-auth"] = "^4.24.7";
  }
  if (payments === "stripe") {
    dependencies.stripe = "^16.2.0";
  }
  if (orm === "drizzle") {
    dependencies["drizzle-orm"] = "^0.33.0";
  }
  if (orm === "prisma") {
    dependencies["@prisma/client"] = "^5.16.1";
    devDependencies.prisma = "^5.16.1";
  }

  if (language === "typescript") {
    devDependencies.typescript = "^5.5.4";
    devDependencies["@types/node"] = "^20.16.5";
    devDependencies["@types/react"] = "^18.3.5";
    devDependencies["@types/react-dom"] = "^18.3.0";
  }

  return `${JSON.stringify(
    {
      name: sanitizePackageName(l2Config.projectName),
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        typecheck: "tsc --noEmit",
      },
      dependencies,
      devDependencies,
    },
    null,
    2,
  )}\n`;
}

function buildTsConfig(language: "typescript" | "javascript"): string {
  const tsconfig: Record<string, unknown> = {
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: language === "javascript",
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
    },
    include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  };

  return `${JSON.stringify(tsconfig, null, 2)}\n`;
}

function buildNextConfig(): string {
  return [
    "/** @type {import('next').NextConfig} */",
    "const nextConfig = {};",
    "",
    "export default nextConfig;",
    "",
  ].join("\n");
}

function buildEnvExample(l2Config: Layer2Config): string {
  const lines = ["# Runtime environment variables"];
  const database = l2Config.techStack.database?.trim().toLowerCase();
  const auth = l2Config.techStack.auth?.trim().toLowerCase();
  const payments = l2Config.techStack.payments?.trim().toLowerCase();

  if (database === "postgres" || database === "postgresql") {
    lines.push("DATABASE_URL=postgres://user:password@localhost:5432/app");
  } else if (database === "sqlite") {
    lines.push("DATABASE_URL=file:./dev.db");
  }

  if (auth === "authjs" || auth === "nextauth" || auth === "next-auth") {
    lines.push("AUTH_SECRET=replace-me");
    lines.push("AUTH_URL=http://localhost:3000");
  }

  if (payments === "stripe") {
    lines.push("STRIPE_SECRET_KEY=sk_test_replace_me");
    lines.push("STRIPE_WEBHOOK_SECRET=whsec_replace_me");
  }

  return `${lines.join("\n")}\n`;
}

function buildReadme(l2Config: Layer2Config): string {
  const tech = l2Config.techStack;
  const lines = [
    `# ${l2Config.projectName}`,
    "",
    "Generated by the project-scaffold agent.",
    "",
    "## Tech Stack",
    `- language: ${tech.language}`,
    `- framework: ${tech.framework}`,
  ];

  if (tech.database) lines.push(`- database: ${tech.database}`);
  if (tech.auth) lines.push(`- auth: ${tech.auth}`);
  if (tech.payments) lines.push(`- payments: ${tech.payments}`);

  lines.push("", "## Scripts", "- `pnpm dev`", "- `pnpm build`", "- `pnpm typecheck`", "");
  return lines.join("\n");
}

function toBaseFileSpecs(l2Config: Layer2Config): FileSpec[] {
  const techStack = {
    language: l2Config.techStack.language,
    framework: l2Config.techStack.framework,
  };

  return [
    FileSpecSchema.parse({
      path: "package.json",
      purpose: "workspace package manifest with framework dependencies",
      techStack,
    }),
    FileSpecSchema.parse({
      path: "tsconfig.json",
      purpose: "baseline compiler configuration for scaffolded project",
      techStack,
    }),
    FileSpecSchema.parse({
      path: "next.config.mjs",
      purpose: "framework configuration",
      techStack,
    }),
    FileSpecSchema.parse({
      path: ".env.example",
      purpose: "documented environment variables inferred from tech stack",
      techStack,
    }),
    FileSpecSchema.parse({
      path: "README.md",
      purpose: "scaffold summary and next steps",
      techStack,
    }),
  ];
}

function buildContent(spec: FileSpec, l2Config: Layer2Config, language: "typescript" | "javascript"): string {
  if (spec.path === "package.json") {
    return buildPackageJson(l2Config, language);
  }
  if (spec.path === "tsconfig.json") {
    return buildTsConfig(language);
  }
  if (spec.path === "next.config.mjs") {
    return buildNextConfig();
  }
  if (spec.path === ".env.example") {
    return buildEnvExample(l2Config);
  }
  if (spec.path === "README.md") {
    return buildReadme(l2Config);
  }
  return `${spec.purpose}\n`;
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

function validateTypeScriptCompilation(scaffoldedFiles: GeneratedFile[]): void {
  const typeScriptFiles = scaffoldedFiles.filter(
    (file) => file.language === "typescript" || file.language === "typescriptreact",
  );
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
    jsx: ts.JsxEmit.Preserve,
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const virtualContents = new Map<string, { content: string; scriptKind: ts.ScriptKind }>();
  const virtualToGeneratedPath = new Map<string, string>();

  for (const file of typeScriptFiles) {
    const virtualAbsolutePath = path.normalize(
      path.resolve(process.cwd(), ".factory", "virtual", "project-scaffold", file.path),
    );
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
  throw new ProjectScaffoldError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function ensureExpectedOutputs(scaffoldedFiles: GeneratedFile[]): void {
  const normalizedPaths = scaffoldedFiles.map((file) => normalizeSlashes(file.path).toLowerCase());
  const hasPackageJson = normalizedPaths.some((filePath) => filePath.endsWith("/package.json") || filePath === "package.json");
  const hasTsConfig = normalizedPaths.some((filePath) => filePath.endsWith("/tsconfig.json") || filePath === "tsconfig.json");
  const hasConfigFile = normalizedPaths.some(
    (filePath) =>
      filePath.endsWith("/next.config.mjs") ||
      filePath.endsWith("/next.config.js") ||
      filePath.endsWith("/next.config.ts") ||
      filePath === "next.config.mjs" ||
      filePath === "next.config.js" ||
      filePath === "next.config.ts",
  );

  if (!hasPackageJson || !hasTsConfig || !hasConfigFile) {
    throw new ProjectScaffoldError(
      "GENERATION_FAILED",
      "scaffold must include package.json, tsconfig.json, and at least one config file",
    );
  }
}

function recoveryForError(code: ProjectScaffoldErrorCode): ProjectScaffoldRecovery {
  if (code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Generated paths must stay inside outputDir; retry with corrected relative paths.",
    };
  }
  if (code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated TypeScript failed validation; retry with compile-safe output.",
    };
  }
  if (code === "INPUT_INVALID" || code === "UNSUPPORTED_STACK") {
    return {
      action: "retry_modified",
      rationale: "Input tech stack or required fields are invalid for project scaffolding.",
    };
  }
  return {
    action: "escalate",
    rationale: "Unexpected scaffolding failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: ProjectScaffoldErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "project-scaffold.failed",
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

function toProjectScaffoldError(error: unknown): { code: ProjectScaffoldErrorCode; message: string } {
  if (error instanceof ProjectScaffoldError) {
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

function buildScaffoldedFiles(input: ProjectScaffoldInput): GeneratedFile[] {
  const l2Config = Layer2ConfigSchema.parse(input.l2Config);
  const framework = normalizeFramework(l2Config.techStack.framework);
  const language = normalizeLanguage(l2Config.techStack.language);

  if (framework !== "nextjs") {
    throw new ProjectScaffoldError("UNSUPPORTED_STACK", `unsupported framework for scaffolding: ${framework}`);
  }

  const outputDir = input.outputDir;
  if (typeof outputDir !== "string" || outputDir.trim().length === 0) {
    throw new ProjectScaffoldError("INPUT_INVALID", "outputDir must be a non-empty string");
  }

  const fileSpecs = toBaseFileSpecs(l2Config);
  const generatedFiles = fileSpecs.map((spec) => {
    const resolvedPath = resolveOutputPath(outputDir, spec.path);
    const languageId = detectLanguage(resolvedPath);
    const content = buildContent(spec, l2Config, language);
    return GeneratedFileSchema.parse({
      path: resolvedPath,
      content,
      language: languageId,
    });
  });

  validateTypeScriptCompilation(generatedFiles);
  ensureExpectedOutputs(generatedFiles);
  return generatedFiles;
}

async function runImpl(input: ProjectScaffoldInput): Promise<ProjectScaffoldOutput> {
  const scaffoldedFiles = buildScaffoldedFiles(input);
  return {
    scaffoldedFiles,
    runtimeEvents: [],
  };
}

export async function run(input: ProjectScaffoldInput): Promise<AgentResult<ProjectScaffoldOutput>> {
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
    const { code, message } = toProjectScaffoldError(error);
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
        scaffoldedFiles: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
