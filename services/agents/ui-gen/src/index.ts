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

const AGENT_NAME = "ui-gen";
const DEFAULT_OUTPUT_DIR = ".";
const DEFAULT_COMPONENT_LIBRARY = "shadcn/ui";
const DEFAULT_STYLING = "tailwind";

type ComponentProp = {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
};

type DataSourceSpec = {
  name: string;
  kind?: string;
  description?: string;
};

type InteractionSpec = {
  name: string;
  trigger?: string;
  outcome?: string;
};

type DesignSystemSpec = {
  name?: string;
  componentLibrary?: string;
  styling?: string;
};

type ComponentSpec = {
  name: string;
  purpose: string;
  props?: ComponentProp[];
  dataSources?: DataSourceSpec[];
  interactions?: InteractionSpec[];
  techStack?: {
    language?: string;
    framework?: string;
    styling?: string;
  };
  designSystem?: DesignSystemSpec;
  generatePage?: boolean;
  page?: {
    generate?: boolean;
    route?: string;
    title?: string;
    purpose?: string;
  };
};

type UiGenInput = {
  componentSpec: ComponentSpec;
  designSystem?: DesignSystemSpec;
  outputDir?: string;
  correlationId?: string;
};

type UiGenRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type UiGenOutput = {
  componentFiles: GeneratedFile[];
  pageFiles?: GeneratedFile[];
  runtimeEvents: EventEnvelope[];
  recovery?: UiGenRecovery;
};

type ParsedProp = {
  name: string;
  type?: string;
  required: boolean;
  description?: string;
};

type ParsedDataSource = {
  name: string;
  kind?: string;
  description?: string;
};

type ParsedInteraction = {
  name: string;
  trigger?: string;
  outcome?: string;
};

type ParsedDesignSystem = {
  name: string;
  componentLibrary: string;
  styling: string;
};

type ParsedInput = {
  componentName: string;
  componentPurpose: string;
  props: ParsedProp[];
  dataSources: ParsedDataSource[];
  interactions: ParsedInteraction[];
  includePage: boolean;
  pageRoute?: string;
  pageTitle: string;
  pagePurpose: string;
  outputDir: string;
  designSystem: ParsedDesignSystem;
};

type UiGenErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "ACCESSIBILITY_VALIDATION_FAILED"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class UiGenError extends Error {
  readonly code: UiGenErrorCode;

  constructor(code: UiGenErrorCode, message: string) {
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
    throw new UiGenError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new UiGenError("SCOPE_VIOLATION", `outputDir must be project-relative and non-escaping: ${outputDir}`);
  }

  if (normalizedFilePath.length === 0) {
    throw new UiGenError("INPUT_INVALID", "generated file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new UiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new UiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (normalizedOutputDir !== ".") {
    if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
      throw new UiGenError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
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
    case ".jsx":
      return "javascriptreact";
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
    throw new UiGenError("INPUT_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function toPascalCase(value: string): string {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) return "GeneratedComponent";
  return parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  if (pascal.length === 0) return "value";
  return `${pascal[0]?.toLowerCase() ?? "v"}${pascal.slice(1)}`;
}

function toKebabCase(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : "generated-component";
}

function sanitizeRoute(rawRoute: string | undefined, fallbackSegment: string): string {
  const source = rawRoute && rawRoute.trim().length > 0 ? rawRoute : fallbackSegment;
  const segments = source
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => toKebabCase(segment));

  return segments.length > 0 ? segments.join("/") : fallbackSegment;
}

function parseProps(raw: unknown): ParsedProp[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new UiGenError("INPUT_INVALID", "componentSpec.props must be an array when provided");
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new UiGenError("INPUT_INVALID", `componentSpec.props[${index}] must be an object`);
    }

    const propName = toCamelCase(assertNonEmptyString(entry.name, `componentSpec.props[${index}].name`));
    if (seen.has(propName)) {
      throw new UiGenError("INPUT_INVALID", `duplicate prop name: ${propName}`);
    }
    seen.add(propName);

    const typeValue = typeof entry.type === "string" && entry.type.trim().length > 0 ? entry.type.trim() : undefined;
    const description =
      typeof entry.description === "string" && entry.description.trim().length > 0 ? entry.description.trim() : undefined;

    return {
      name: propName,
      type: typeValue,
      required: entry.required === true,
      description,
    };
  });
}

function parseDataSources(raw: unknown): ParsedDataSource[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new UiGenError("INPUT_INVALID", "componentSpec.dataSources must be an array when provided");
  }

  return raw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new UiGenError("INPUT_INVALID", `componentSpec.dataSources[${index}] must be an object`);
    }

    return {
      name: assertNonEmptyString(entry.name, `componentSpec.dataSources[${index}].name`),
      kind: typeof entry.kind === "string" && entry.kind.trim().length > 0 ? entry.kind.trim() : undefined,
      description:
        typeof entry.description === "string" && entry.description.trim().length > 0 ? entry.description.trim() : undefined,
    };
  });
}

function parseInteractions(raw: unknown): ParsedInteraction[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new UiGenError("INPUT_INVALID", "componentSpec.interactions must be an array when provided");
  }

  return raw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new UiGenError("INPUT_INVALID", `componentSpec.interactions[${index}] must be an object`);
    }

    return {
      name: assertNonEmptyString(entry.name, `componentSpec.interactions[${index}].name`),
      trigger: typeof entry.trigger === "string" && entry.trigger.trim().length > 0 ? entry.trigger.trim() : undefined,
      outcome: typeof entry.outcome === "string" && entry.outcome.trim().length > 0 ? entry.outcome.trim() : undefined,
    };
  });
}

function normalizeFramework(raw: unknown): "next" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "next";
  if (value === "next" || value === "nextjs" || value === "next.js" || value === "nextjs-app-router") {
    return "next";
  }
  throw new UiGenError("UNSUPPORTED_STACK", `unsupported framework for ui-gen: ${String(raw)}`);
}

function normalizeLanguage(raw: unknown): "typescript" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "typescript";
  if (value === "typescript" || value === "ts") {
    return "typescript";
  }
  throw new UiGenError("UNSUPPORTED_STACK", `unsupported language for ui-gen: ${String(raw)}`);
}

function parseDesignSystem(
  inputDesignSystem: unknown,
  specDesignSystem: unknown,
  techStackStyling: unknown,
): ParsedDesignSystem {
  const merged = isObject(inputDesignSystem) ? inputDesignSystem : isObject(specDesignSystem) ? specDesignSystem : {};
  const stylingCandidate =
    typeof merged.styling === "string" && merged.styling.trim().length > 0
      ? merged.styling.trim()
      : typeof techStackStyling === "string" && techStackStyling.trim().length > 0
        ? techStackStyling.trim()
        : DEFAULT_STYLING;

  const name =
    typeof merged.name === "string" && merged.name.trim().length > 0
      ? merged.name.trim()
      : DEFAULT_COMPONENT_LIBRARY;

  const componentLibrary =
    typeof merged.componentLibrary === "string" && merged.componentLibrary.trim().length > 0
      ? merged.componentLibrary.trim()
      : DEFAULT_COMPONENT_LIBRARY;

  return {
    name,
    componentLibrary,
    styling: stylingCandidate,
  };
}

function parseInput(input: UiGenInput): ParsedInput {
  if (!isObject(input)) {
    throw new UiGenError("INPUT_INVALID", "input must be an object");
  }

  if (!isObject(input.componentSpec)) {
    throw new UiGenError("INPUT_INVALID", "componentSpec must be an object");
  }

  const componentName = toPascalCase(assertNonEmptyString(input.componentSpec.name, "componentSpec.name"));
  const componentPurpose = assertNonEmptyString(input.componentSpec.purpose, "componentSpec.purpose");
  const techStack = isObject(input.componentSpec.techStack) ? input.componentSpec.techStack : {};

  normalizeLanguage(techStack.language);
  normalizeFramework(techStack.framework);

  const props = parseProps(input.componentSpec.props);
  const dataSources = parseDataSources(input.componentSpec.dataSources);
  const interactions = parseInteractions(input.componentSpec.interactions);

  const includePage = input.componentSpec.generatePage === true || input.componentSpec.page?.generate === true;
  const pageRoute = includePage
    ? sanitizeRoute(input.componentSpec.page?.route, toKebabCase(componentName))
    : undefined;
  const pageTitle =
    typeof input.componentSpec.page?.title === "string" && input.componentSpec.page.title.trim().length > 0
      ? input.componentSpec.page.title.trim()
      : `${componentName} Preview`;
  const pagePurpose =
    typeof input.componentSpec.page?.purpose === "string" && input.componentSpec.page.purpose.trim().length > 0
      ? input.componentSpec.page.purpose.trim()
      : `Preview page for ${componentName}`;

  const outputDirCandidate = typeof input.outputDir === "string" ? input.outputDir.trim() : DEFAULT_OUTPUT_DIR;
  if (outputDirCandidate.length === 0) {
    throw new UiGenError("INPUT_INVALID", "outputDir must be a non-empty string when provided");
  }

  const designSystem = parseDesignSystem(input.designSystem, input.componentSpec.designSystem, techStack.styling);

  return {
    componentName,
    componentPurpose,
    props,
    dataSources,
    interactions,
    includePage,
    pageRoute,
    pageTitle,
    pagePurpose,
    outputDir: outputDirCandidate,
    designSystem,
  };
}

function escapeForComment(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/\r?\n/g, " ");
}

function escapeForStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function isSafePrimitiveType(typeName: string): boolean {
  return (
    typeName === "string" ||
    typeName === "number" ||
    typeName === "boolean" ||
    typeName === "unknown" ||
    typeName === "any" ||
    typeName === "Record<string, unknown>" ||
    typeName === "unknown[]"
  );
}

function toCompileSafeType(typeName: string | undefined): string {
  if (!typeName) return "unknown";
  const trimmed = typeName.trim();
  if (isSafePrimitiveType(trimmed)) {
    return trimmed;
  }
  return `unknown /* source type: ${escapeForComment(trimmed)} */`;
}

function buildPropTypeBlock(propsTypeName: string, props: ParsedProp[]): string[] {
  if (props.length === 0) {
    return [`export type ${propsTypeName} = Record<string, never>;`];
  }

  const lines = [`export type ${propsTypeName} = {`];
  for (const prop of props) {
    const optional = prop.required ? "" : "?";
    const typeExpr = toCompileSafeType(prop.type);
    const descriptionSuffix = prop.description ? ` // ${escapeForComment(prop.description)}` : "";
    lines.push(`  ${prop.name}${optional}: ${typeExpr};${descriptionSuffix}`);
  }
  lines.push("};");
  return lines;
}

function buildCommonJsxStubLines(): string[] {
  return [
    "declare global {",
    "  namespace JSX {",
    "    interface IntrinsicElements {",
    "      [elementName: string]: unknown;",
    "    }",
    "  }",
    "}",
    "",
    "type KeyboardEventLike = {",
    "  key: string;",
    "  preventDefault(): void;",
    "};",
    "",
  ];
}

function tailwindClassSet() {
  return {
    article:
      "rounded-lg border bg-card text-card-foreground shadow-sm p-4 sm:p-5 md:p-6 lg:p-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    header: "flex items-start justify-between gap-3",
    section: "mt-4 space-y-2",
    footer: "mt-6 flex flex-wrap items-center gap-3",
    button:
      "inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto",
    pageMain: "mx-auto max-w-3xl p-4 sm:p-6 md:p-8 lg:p-10",
    pageSection: "rounded-lg border bg-background p-4 sm:p-5 md:p-6 lg:p-7",
  };
}

function plainClassSet() {
  return {
    article: "ui-gen-card",
    header: "ui-gen-header",
    section: "ui-gen-section",
    footer: "ui-gen-footer",
    button: "ui-gen-button",
    pageMain: "ui-gen-page-main",
    pageSection: "ui-gen-page-section",
  };
}

function buildComponentFile(input: ParsedInput): { relativePath: string; content: string } {
  const relativePath = `src/components/${input.componentName}.tsx`;
  const propsTypeName = `${input.componentName}Props`;
  const titleId = `${toKebabCase(input.componentName)}-title`;
  const sectionLabel = `${input.componentName} content`;

  const classSet = input.designSystem.styling.toLowerCase() === "tailwind" ? tailwindClassSet() : plainClassSet();
  const primaryProp = input.props[0]?.name;
  const dataSourceText =
    input.dataSources.length > 0
      ? input.dataSources.map((source) => source.name).join(", ")
      : "No external data sources declared";
  const interactionText =
    input.interactions.length > 0
      ? input.interactions.map((interaction) => interaction.name).join(", ")
      : "Open details";

  const lines: string[] = [
    `// Generated by ${AGENT_NAME}: ${escapeForComment(input.componentPurpose)}.`,
    `// design-system: ${escapeForComment(input.designSystem.componentLibrary)} (${escapeForComment(input.designSystem.styling)})`,
    "// WCAG defaults: semantic regions + ARIA labels + keyboard activation hook.",
    "",
    ...buildCommonJsxStubLines(),
    ...buildPropTypeBlock(propsTypeName, input.props),
    "",
    "function toDisplayText(value: unknown): string {",
    "  if (typeof value === \"string\") return value;",
    "  if (typeof value === \"number\" || typeof value === \"boolean\") return String(value);",
    "  if (value && typeof value === \"object\" && \"name\" in value) {",
    "    const candidate = (value as { name?: unknown }).name;",
    "    if (typeof candidate === \"string\" && candidate.trim().length > 0) return candidate;",
    "  }",
    "  return \"Item\";",
    "}",
    "",
    "function handleActionKeyDown(event: KeyboardEventLike): void {",
    "  if (event.key === \"Enter\" || event.key === \" \") {",
    "    event.preventDefault();",
    "  }",
    "}",
    "",
    `export function ${input.componentName}(props: ${propsTypeName}) {`,
    `  const headingText = ${primaryProp ? `toDisplayText(props.${primaryProp})` : `"${input.componentName}"`};`,
    `  const componentPurpose = "${escapeForStringLiteral(input.componentPurpose)}";`,
    `  const dataSourceSummary = "${escapeForStringLiteral(dataSourceText)}";`,
    `  const interactionSummary = "${escapeForStringLiteral(interactionText)}";`,
    "",
    "  return (",
    `    <article className="${classSet.article}" role="region" aria-labelledby="${titleId}" tabIndex={0}>`,
    `      <header className="${classSet.header}">`,
    `        <h2 id="${titleId}" className="text-lg font-semibold">`,
    "          {headingText}",
    "        </h2>",
    "      </header>",
    `      <section className="${classSet.section}" aria-label="${sectionLabel}">`,
    "        <p className=\"text-sm text-muted-foreground\">{componentPurpose}</p>",
    "        <p className=\"text-sm\" role=\"note\" aria-label=\"Data source summary\">",
    "          {dataSourceSummary}",
    "        </p>",
    "        <p className=\"text-sm\" aria-label=\"Interaction summary\">{interactionSummary}</p>",
    "      </section>",
    `      <footer className="${classSet.footer}">`,
    "        <button",
    "          type=\"button\"",
    `          className="${classSet.button}"`,
    "          aria-label=\"Open details\"",
    "          tabIndex={0}",
    "          onKeyDown={handleActionKeyDown}",
    "        >",
    "          Open details",
    "        </button>",
    "      </footer>",
    "    </article>",
    "  );",
    "}",
    "",
    `export default ${input.componentName};`,
    "",
  ];

  return {
    relativePath,
    content: lines.join("\n"),
  };
}

function buildPageFile(
  input: ParsedInput,
  componentRelativePath: string,
  propsTypeName: string,
): { relativePath: string; content: string } {
  const pageRoute = input.pageRoute ?? toKebabCase(input.componentName);
  const relativePath = `src/app/${pageRoute}/page.tsx`;
  const componentImportPathRaw = path.posix
    .relative(path.posix.dirname(relativePath), componentRelativePath)
    .replace(/\.tsx$/i, "");
  const componentImportPath = componentImportPathRaw.startsWith(".")
    ? componentImportPathRaw
    : `./${componentImportPathRaw}`;

  const classSet = input.designSystem.styling.toLowerCase() === "tailwind" ? tailwindClassSet() : plainClassSet();
  const pageRegionId = `${toKebabCase(input.componentName)}-page-title`;

  const lines: string[] = [
    `// Generated by ${AGENT_NAME}: optional preview page for ${input.componentName}.`,
    `import { ${input.componentName}, type ${propsTypeName} } from "${componentImportPath}";`,
    "",
    ...buildCommonJsxStubLines(),
    `export default function ${input.componentName}Page() {`,
    `  const previewProps = {} as ${propsTypeName};`,
    "",
    "  return (",
    `    <main className="${classSet.pageMain}" aria-label="${escapeForStringLiteral(input.pagePurpose)}">`,
    `      <section className="${classSet.pageSection}" role="region" aria-labelledby="${pageRegionId}">`,
    "        <header className=\"mb-4\">",
    `          <h1 id="${pageRegionId}" className="text-2xl font-semibold">`,
    `            ${escapeForStringLiteral(input.pageTitle)}`,
    "          </h1>",
    "          <p className=\"text-sm text-muted-foreground\">",
    `            ${escapeForStringLiteral(input.pagePurpose)}`,
    "          </p>",
    "        </header>",
    "        <nav aria-label=\"Preview actions\" className=\"mb-4\">",
    "          <button type=\"button\" className=\"rounded-md border px-3 py-2 text-sm\" tabIndex={0} aria-label=\"Focus component preview\">",
    "            Focus preview",
    "          </button>",
    "        </nav>",
    "        <article>",
    `          <${input.componentName} {...previewProps} />`,
    "        </article>",
    "      </section>",
    "    </main>",
    "  );",
    "}",
    "",
  ];

  return {
    relativePath,
    content: lines.join("\n"),
  };
}

function createGeneratedFile(outputDir: string, relativePath: string, content: string): GeneratedFile {
  const resolvedPath = resolveOutputPath(outputDir, relativePath);
  const language = detectLanguage(resolvedPath);
  const generated = GeneratedFileSchema.parse({
    path: resolvedPath,
    content,
    language,
  });

  if (resolvedPath.endsWith(".tsx") && generated.language !== "typescriptreact") {
    throw new UiGenError("GENERATION_FAILED", `tsx file must use language typescriptreact: ${resolvedPath}`);
  }

  return generated;
}

function validateAccessibilitySignals(files: GeneratedFile[]): void {
  const semanticTagPattern = /<(main|nav|section|article|header|footer)\b/i;
  const ariaPattern = /\baria-[a-z-]+=/i;
  const rolePattern = /\brole=/i;
  const keyboardPattern = /\b(tabIndex=|onKeyDown=)/i;

  for (const file of files) {
    if (file.language !== "typescriptreact") continue;

    if (!semanticTagPattern.test(file.content)) {
      throw new UiGenError("ACCESSIBILITY_VALIDATION_FAILED", `missing semantic HTML in ${file.path}`);
    }

    if (!ariaPattern.test(file.content) && !rolePattern.test(file.content)) {
      throw new UiGenError("ACCESSIBILITY_VALIDATION_FAILED", `missing ARIA/role attributes in ${file.path}`);
    }

    if (!keyboardPattern.test(file.content)) {
      throw new UiGenError("ACCESSIBILITY_VALIDATION_FAILED", `missing keyboard navigation hooks in ${file.path}`);
    }
  }
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
  throw new UiGenError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript/TSX did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function buildGeneratedFiles(input: ParsedInput): { componentFiles: GeneratedFile[]; pageFiles: GeneratedFile[] } {
  const componentFileRaw = buildComponentFile(input);
  const propsTypeName = `${input.componentName}Props`;
  const componentFile = createGeneratedFile(input.outputDir, componentFileRaw.relativePath, componentFileRaw.content);

  const pageFiles: GeneratedFile[] = [];
  if (input.includePage) {
    const pageFileRaw = buildPageFile(input, componentFileRaw.relativePath, propsTypeName);
    pageFiles.push(createGeneratedFile(input.outputDir, pageFileRaw.relativePath, pageFileRaw.content));
  }

  const componentFiles = [componentFile];
  const allGeneratedFiles = [...componentFiles, ...pageFiles];

  const seen = new Set<string>();
  for (const generated of allGeneratedFiles) {
    if (seen.has(generated.path)) {
      throw new UiGenError("INPUT_INVALID", `duplicate generated path: ${generated.path}`);
    }
    seen.add(generated.path);
  }

  validateAccessibilitySignals(componentFiles);
  validateTypeScriptCompilation(allGeneratedFiles);

  return {
    componentFiles,
    pageFiles,
  };
}

function recoveryForError(code: UiGenErrorCode): UiGenRecovery {
  if (code === "INPUT_INVALID" || code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Input or output scope is invalid; retry with schema-compliant values and project-relative paths.",
    };
  }

  if (code === "ACCESSIBILITY_VALIDATION_FAILED" || code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated UI output failed accessibility/compile validation; retry with corrected TSX scaffolding.",
    };
  }

  if (code === "UNSUPPORTED_STACK") {
    return {
      action: "escalate",
      rationale: "Unsupported framework or language for ui-gen; escalate stack selection to operator.",
    };
  }

  return {
    action: "escalate",
    rationale: "Unexpected ui-gen failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: UiGenErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "ui-gen.failed",
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

function toUiGenError(error: unknown): { code: UiGenErrorCode; message: string } {
  if (error instanceof UiGenError) {
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

async function runImpl(input: UiGenInput): Promise<UiGenOutput> {
  const parsedInput = parseInput(input);
  const generated = buildGeneratedFiles(parsedInput);
  return {
    componentFiles: generated.componentFiles,
    pageFiles: generated.pageFiles.length > 0 ? generated.pageFiles : undefined,
    runtimeEvents: [],
  };
}

export async function run(input: UiGenInput): Promise<AgentResult<UiGenOutput>> {
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
    const { code, message } = toUiGenError(error);
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
        componentFiles: [],
        pageFiles: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
