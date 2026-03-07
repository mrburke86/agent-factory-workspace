import path from "node:path";
import ts from "typescript";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  EventEnvelopeSchema,
  GeneratedFileSchema,
  type EventEnvelope,
  type FileSpec,
  type GeneratedFile,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "db-schema";
const DEFAULT_ORM = "drizzle";
const DEFAULT_DATABASE = "postgresql";

type DatabaseKind = "postgresql" | "sqlite";
type OrmKind = "drizzle" | "prisma";

type FieldSpec = {
  name: string;
  type: string;
  primaryKey?: boolean;
  unique?: boolean;
  nullable?: boolean;
  references?: {
    entity: string;
    field: string;
  };
};

type EntitySpec = {
  name: string;
  fields: FieldSpec[];
};

type RelationshipSpec =
  | {
      type: "one-to-many";
      from: string;
      to: string;
      foreignKey: string;
    }
  | {
      type: "many-to-many";
      from: string;
      to: string;
      junctionTable: string;
    }
  | {
      type: "self-referential";
      entity: string;
      foreignKey: string;
    };

type DbSchemaInput = {
  dataModel: {
    entities: EntitySpec[];
    relationships?: RelationshipSpec[];
  };
  techStack: {
    database?: DatabaseKind;
    orm?: OrmKind;
  };
  outputDir: string;
  seedData?: Record<string, Array<Record<string, unknown>>>;
  correlationId?: string;
};

type DbSchemaRecovery = {
  action: RecoveryAction;
  rationale: string;
};

type DbSchemaOutput = {
  schemaFiles: GeneratedFile[];
  migrationFiles: GeneratedFile[];
  seedFile?: GeneratedFile;
  runtimeEvents: EventEnvelope[];
  recovery?: DbSchemaRecovery;
};

type ParsedInput = {
  entities: EntitySpec[];
  relationships: RelationshipSpec[];
  database: DatabaseKind;
  orm: OrmKind;
  outputDir: string;
  seedData?: Record<string, Array<Record<string, unknown>>>;
};

type DbSchemaErrorCode =
  | "INPUT_INVALID"
  | "UNSUPPORTED_STACK"
  | "SCOPE_VIOLATION"
  | "COMPILE_VALIDATION_FAILED"
  | "GENERATION_FAILED";

class DbSchemaError extends Error {
  readonly code: DbSchemaErrorCode;

  constructor(code: DbSchemaErrorCode, message: string) {
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
    throw new DbSchemaError("INPUT_INVALID", "outputDir cannot be empty");
  }

  if (
    normalizedOutputDir.startsWith("/") ||
    isWindowsAbsolutePath(normalizedOutputDir) ||
    normalizedOutputDir === ".." ||
    normalizedOutputDir.startsWith("../")
  ) {
    throw new DbSchemaError("SCOPE_VIOLATION", `outputDir must be project-relative and non-escaping: ${outputDir}`);
  }

  if (normalizedFilePath.length === 0) {
    throw new DbSchemaError("INPUT_INVALID", "generated file path cannot be empty");
  }

  if (
    normalizedFilePath.startsWith("/") ||
    isWindowsAbsolutePath(normalizedFilePath) ||
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../")
  ) {
    throw new DbSchemaError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  const resolvedPath = path.posix.normalize(path.posix.join(normalizedOutputDir, normalizedFilePath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../")) {
    throw new DbSchemaError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
  }

  if (normalizedOutputDir !== ".") {
    if (!(resolvedPath === normalizedOutputDir || resolvedPath.startsWith(`${normalizedOutputDir}/`))) {
      throw new DbSchemaError("SCOPE_VIOLATION", `path is outside outputDir: ${filePath}`);
    }
  }

  return resolvedPath;
}

function toIdentifier(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length === 0) {
    return "field";
  }

  if (/^[0-9]/.test(normalized)) {
    return `f_${normalized}`;
  }

  return normalized;
}

function toCamelCase(value: string): string {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "entity";
  }

  const [head, ...tail] = parts;
  return `${toIdentifier(head.toLowerCase())}${tail.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("")}`;
}

function toPascalCase(value: string): string {
  return (
    value
      .trim()
      .split(/[^A-Za-z0-9]+/)
      .filter((part) => part.length > 0)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join("") || "Model"
  );
}

function singularize(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().endsWith("ies") && trimmed.length > 3) {
    return `${trimmed.slice(0, -3)}y`;
  }
  if (trimmed.toLowerCase().endsWith("s") && trimmed.length > 1) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function detectLanguage(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".sql":
      return "sql";
    case ".prisma":
      return "prisma";
    case ".json":
      return "json";
    default:
      return "plaintext";
  }
}

function mapFieldTypeToDrizzleBuilder(fieldType: string, database: DatabaseKind): string {
  const normalized = fieldType.trim().toLowerCase();

  if (normalized === "uuid") {
    return database === "sqlite" ? "text" : "uuid";
  }
  if (normalized === "string") {
    return database === "sqlite" ? "text" : "varchar";
  }
  if (normalized === "text") {
    return "text";
  }
  if (normalized === "integer" || normalized === "int") {
    return "integer";
  }
  if (normalized === "boolean") {
    return "boolean";
  }
  if (normalized === "datetime" || normalized === "timestamp") {
    return "timestamp";
  }

  return database === "sqlite" ? "text" : "varchar";
}

function mapFieldTypeToSql(fieldType: string, database: DatabaseKind): string {
  const normalized = fieldType.trim().toLowerCase();

  if (normalized === "uuid") {
    return database === "sqlite" ? "text" : "uuid";
  }
  if (normalized === "string") {
    return database === "sqlite" ? "text" : "varchar(255)";
  }
  if (normalized === "text") {
    return "text";
  }
  if (normalized === "integer" || normalized === "int") {
    return "integer";
  }
  if (normalized === "boolean") {
    return database === "sqlite" ? "integer" : "boolean";
  }
  if (normalized === "datetime" || normalized === "timestamp") {
    return database === "sqlite" ? "text" : "timestamp";
  }

  return database === "sqlite" ? "text" : "varchar(255)";
}

function mapFieldTypeToPrisma(fieldType: string): string {
  const normalized = fieldType.trim().toLowerCase();

  if (normalized === "uuid") return "String";
  if (normalized === "string") return "String";
  if (normalized === "text") return "String";
  if (normalized === "integer" || normalized === "int") return "Int";
  if (normalized === "boolean") return "Boolean";
  if (normalized === "datetime" || normalized === "timestamp") return "DateTime";

  return "String";
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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
    const virtualAbsolutePath = path.normalize(path.resolve(process.cwd(), ".factory", "virtual", "db-schema", file.path));
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
  throw new DbSchemaError(
    "COMPILE_VALIDATION_FAILED",
    `generated TypeScript did not pass noEmit validation: ${diagnosticMessages.join(" | ")}`,
  );
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DbSchemaError("INPUT_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseField(rawField: unknown, entityName: string, seenKeys: Set<string>): FieldSpec {
  if (!rawField || typeof rawField !== "object") {
    throw new DbSchemaError("INPUT_INVALID", `entity ${entityName} contains an invalid field`);
  }

  const record = rawField as Record<string, unknown>;
  const name = assertNonEmptyString(record.name, `field.name in entity ${entityName}`);
  const type = assertNonEmptyString(record.type, `field.type in entity ${entityName}.${name}`);
  const key = toIdentifier(name);

  if (seenKeys.has(key)) {
    throw new DbSchemaError("INPUT_INVALID", `entity ${entityName} contains duplicate field key: ${key}`);
  }
  seenKeys.add(key);

  let references: FieldSpec["references"];
  if (record.references !== undefined) {
    if (!record.references || typeof record.references !== "object") {
      throw new DbSchemaError("INPUT_INVALID", `references in ${entityName}.${name} must be an object`);
    }

    const referencesRecord = record.references as Record<string, unknown>;
    references = {
      entity: assertNonEmptyString(referencesRecord.entity, `references.entity in ${entityName}.${name}`),
      field: assertNonEmptyString(referencesRecord.field, `references.field in ${entityName}.${name}`),
    };
  }

  return {
    name,
    type,
    primaryKey: record.primaryKey === true,
    unique: record.unique === true,
    nullable: record.nullable === true,
    references,
  };
}

function parseEntity(rawEntity: unknown): EntitySpec {
  if (!rawEntity || typeof rawEntity !== "object") {
    throw new DbSchemaError("INPUT_INVALID", "entity must be an object");
  }

  const record = rawEntity as Record<string, unknown>;
  const name = assertNonEmptyString(record.name, "entity.name");

  if (!Array.isArray(record.fields) || record.fields.length === 0) {
    throw new DbSchemaError("INPUT_INVALID", `entity ${name} must contain at least one field`);
  }

  const seenKeys = new Set<string>();
  const fields = record.fields.map((field) => parseField(field, name, seenKeys));

  return { name, fields };
}

function parseRelationship(rawRelationship: unknown): RelationshipSpec {
  if (!rawRelationship || typeof rawRelationship !== "object") {
    throw new DbSchemaError("INPUT_INVALID", "relationship must be an object");
  }

  const record = rawRelationship as Record<string, unknown>;
  const type = assertNonEmptyString(record.type, "relationship.type");

  if (type === "one-to-many") {
    return {
      type,
      from: assertNonEmptyString(record.from, "relationship.from"),
      to: assertNonEmptyString(record.to, "relationship.to"),
      foreignKey: assertNonEmptyString(record.foreignKey, "relationship.foreignKey"),
    };
  }

  if (type === "many-to-many") {
    return {
      type,
      from: assertNonEmptyString(record.from, "relationship.from"),
      to: assertNonEmptyString(record.to, "relationship.to"),
      junctionTable: assertNonEmptyString(record.junctionTable, "relationship.junctionTable"),
    };
  }

  if (type === "self-referential") {
    return {
      type,
      entity: assertNonEmptyString(record.entity, "relationship.entity"),
      foreignKey: assertNonEmptyString(record.foreignKey, "relationship.foreignKey"),
    };
  }

  throw new DbSchemaError("INPUT_INVALID", `unsupported relationship.type: ${type}`);
}

function parseInput(input: DbSchemaInput): ParsedInput {
  if (!input || typeof input !== "object") {
    throw new DbSchemaError("INPUT_INVALID", "input must be an object");
  }

  const entities = Array.isArray(input.dataModel?.entities) ? input.dataModel.entities.map(parseEntity) : [];
  if (entities.length === 0) {
    throw new DbSchemaError("INPUT_INVALID", "dataModel.entities must contain at least one entity");
  }

  const entityNames = new Set<string>();
  for (const entity of entities) {
    const key = entity.name.toLowerCase();
    if (entityNames.has(key)) {
      throw new DbSchemaError("INPUT_INVALID", `duplicate entity name: ${entity.name}`);
    }
    entityNames.add(key);
  }

  const relationships = Array.isArray(input.dataModel?.relationships)
    ? input.dataModel.relationships.map(parseRelationship)
    : [];

  const databaseRaw = input.techStack?.database ?? DEFAULT_DATABASE;
  if (databaseRaw !== "postgresql" && databaseRaw !== "sqlite") {
    throw new DbSchemaError("UNSUPPORTED_STACK", `unsupported database: ${String(databaseRaw)}`);
  }

  const ormRaw = input.techStack?.orm ?? DEFAULT_ORM;
  if (ormRaw !== "drizzle" && ormRaw !== "prisma") {
    throw new DbSchemaError("UNSUPPORTED_STACK", `unsupported orm: ${String(ormRaw)}`);
  }

  const outputDir = assertNonEmptyString(input.outputDir, "outputDir");

  const seedData = input.seedData;
  if (seedData !== undefined) {
    if (!seedData || typeof seedData !== "object" || Array.isArray(seedData)) {
      throw new DbSchemaError("INPUT_INVALID", "seedData must be an object keyed by entity name");
    }
  }

  validateRelationships(entities, relationships);

  return {
    entities,
    relationships,
    database: databaseRaw,
    orm: ormRaw,
    outputDir,
    seedData,
  };
}

function validateRelationships(entities: EntitySpec[], relationships: RelationshipSpec[]): void {
  const entityMap = new Map<string, EntitySpec>();
  for (const entity of entities) {
    entityMap.set(entity.name, entity);
  }

  for (const relationship of relationships) {
    if (relationship.type === "one-to-many") {
      const fromEntity = entityMap.get(relationship.from);
      const toEntity = entityMap.get(relationship.to);
      if (!fromEntity || !toEntity) {
        throw new DbSchemaError(
          "INPUT_INVALID",
          `one-to-many relationship references missing entities: ${relationship.from} -> ${relationship.to}`,
        );
      }

      const fkField = toEntity.fields.find((field) => field.name === relationship.foreignKey);
      if (!fkField) {
        throw new DbSchemaError(
          "INPUT_INVALID",
          `one-to-many relationship foreign key not found: ${relationship.to}.${relationship.foreignKey}`,
        );
      }
    }

    if (relationship.type === "many-to-many") {
      const fromEntity = entityMap.get(relationship.from);
      const toEntity = entityMap.get(relationship.to);
      if (!fromEntity || !toEntity) {
        throw new DbSchemaError(
          "INPUT_INVALID",
          `many-to-many relationship references missing entities: ${relationship.from} <-> ${relationship.to}`,
        );
      }
    }

    if (relationship.type === "self-referential") {
      const entity = entityMap.get(relationship.entity);
      if (!entity) {
        throw new DbSchemaError("INPUT_INVALID", `self-referential relationship references missing entity: ${relationship.entity}`);
      }

      const fkField = entity.fields.find((field) => field.name === relationship.foreignKey);
      if (!fkField) {
        throw new DbSchemaError(
          "INPUT_INVALID",
          `self-referential relationship foreign key not found: ${relationship.entity}.${relationship.foreignKey}`,
        );
      }
    }
  }
}

function getPrimaryKeyField(entity: EntitySpec): FieldSpec {
  const explicitPrimary = entity.fields.find((field) => field.primaryKey);
  if (explicitPrimary) {
    return explicitPrimary;
  }

  const idField = entity.fields.find((field) => field.name === "id");
  if (idField) {
    return idField;
  }

  return entity.fields[0];
}

function drizzleColumnExpression(field: FieldSpec, database: DatabaseKind, referenceExpression?: string): string {
  const builder = mapFieldTypeToDrizzleBuilder(field.type, database);
  const method = builder === "varchar" ? `varchar(${JSON.stringify(field.name)}, { length: 255 })` : `${builder}(${JSON.stringify(field.name)})`;
  const calls: string[] = [];

  if (field.primaryKey) {
    calls.push("primaryKey()");
  }

  if (!field.nullable) {
    calls.push("notNull()");
  }

  if (field.unique) {
    calls.push("unique()");
  }

  if (field.references && referenceExpression) {
    calls.push(`references(() => ${referenceExpression})`);
  }

  return calls.length > 0 ? `${method}.${calls.join(".")}` : method;
}

function buildDrizzleSchemaContent(input: ParsedInput): string {
  const tableFactory = input.database === "sqlite" ? "sqliteTable" : "pgTable";
  const entityByName = new Map<string, EntitySpec>();
  for (const entity of input.entities) {
    entityByName.set(entity.name, entity);
  }

  const fieldKeyMap = new Map<string, Map<string, string>>();
  for (const entity of input.entities) {
    const keys = new Map<string, string>();
    for (const field of entity.fields) {
      keys.set(field.name, toIdentifier(field.name));
    }
    fieldKeyMap.set(entity.name, keys);
  }

  const lines: string[] = [
    "// Deterministic db-schema output for Drizzle ORM.",
    "// This file is compile-safe in isolation and mirrors Drizzle-style table definitions.",
    "",
    "type ColumnShape = { name: string; kind: string };",
    "type ColumnBuilder = {",
    "  notNull(): ColumnBuilder;",
    "  primaryKey(): ColumnBuilder;",
    "  unique(): ColumnBuilder;",
    "  references(ref: () => ColumnShape): ColumnBuilder;",
    "};",
    "",
    "declare function uuid(name: string): ColumnBuilder;",
    "declare function varchar(name: string, config: { length: number }): ColumnBuilder;",
    "declare function text(name: string): ColumnBuilder;",
    "declare function integer(name: string): ColumnBuilder;",
    "declare function boolean(name: string): ColumnBuilder;",
    "declare function timestamp(name: string): ColumnBuilder;",
    "declare function ref(table: string, field: string): ColumnShape;",
    "",
    "declare function pgTable<T extends Record<string, ColumnBuilder>>(name: string, columns: T): { [K in keyof T]: ColumnShape };",
    "declare function sqliteTable<T extends Record<string, ColumnBuilder>>(name: string, columns: T): { [K in keyof T]: ColumnShape };",
    "",
    `const table = ${tableFactory};`,
    "",
  ];

  for (const entity of input.entities) {
    const tableVar = toCamelCase(entity.name);
    lines.push(`export const ${tableVar} = table(${JSON.stringify(entity.name)}, {`);

    for (const field of entity.fields) {
      const fieldKey = fieldKeyMap.get(entity.name)?.get(field.name) ?? toIdentifier(field.name);
      const referenceExpression = field.references
        ? `ref(${JSON.stringify(field.references.entity)}, ${JSON.stringify(field.references.field)})`
        : undefined;
      const expression = drizzleColumnExpression(field, input.database, referenceExpression);
      lines.push(`  ${fieldKey}: ${expression},`);
    }

    lines.push("});");
    lines.push("");
  }

  for (const relationship of input.relationships) {
    if (relationship.type !== "many-to-many") {
      continue;
    }

    const fromEntity = entityByName.get(relationship.from);
    const toEntity = entityByName.get(relationship.to);
    if (!fromEntity || !toEntity) {
      throw new DbSchemaError("INPUT_INVALID", `relationship references missing entity for junction table ${relationship.junctionTable}`);
    }

    const fromPrimary = getPrimaryKeyField(fromEntity);
    const toPrimary = getPrimaryKeyField(toEntity);
    const fromColumnName = `${toCamelCase(singularize(relationship.from))}Id`;
    const toColumnName = `${toCamelCase(singularize(relationship.to))}Id`;
    const tableVar = toCamelCase(relationship.junctionTable);
    lines.push(`export const ${tableVar} = table(${JSON.stringify(relationship.junctionTable)}, {`);
    lines.push(
      `  ${toIdentifier(fromColumnName)}: ${drizzleColumnExpression(
        {
          name: fromColumnName,
          type: fromPrimary.type,
          nullable: false,
          references: { entity: fromEntity.name, field: fromPrimary.name },
        },
        input.database,
        `ref(${JSON.stringify(fromEntity.name)}, ${JSON.stringify(fromPrimary.name)})`,
      )},`,
    );
    lines.push(
      `  ${toIdentifier(toColumnName)}: ${drizzleColumnExpression(
        {
          name: toColumnName,
          type: toPrimary.type,
          nullable: false,
          references: { entity: toEntity.name, field: toPrimary.name },
        },
        input.database,
        `ref(${JSON.stringify(toEntity.name)}, ${JSON.stringify(toPrimary.name)})`,
      )},`,
    );
    lines.push("});");
    lines.push("");
  }

  lines.push("export const relationshipGraph = [");
  for (const relationship of input.relationships) {
    if (relationship.type === "one-to-many") {
      lines.push(
        `  { type: ${JSON.stringify(relationship.type)}, from: ${JSON.stringify(relationship.from)}, to: ${JSON.stringify(
          relationship.to,
        )}, foreignKey: ${JSON.stringify(relationship.foreignKey)} },`,
      );
      continue;
    }

    if (relationship.type === "many-to-many") {
      lines.push(
        `  { type: ${JSON.stringify(relationship.type)}, from: ${JSON.stringify(relationship.from)}, to: ${JSON.stringify(
          relationship.to,
        )}, junctionTable: ${JSON.stringify(relationship.junctionTable)} },`,
      );
      continue;
    }

    lines.push(
      `  { type: ${JSON.stringify(relationship.type)}, entity: ${JSON.stringify(relationship.entity)}, foreignKey: ${JSON.stringify(
        relationship.foreignKey,
      )} },`,
    );
  }
  lines.push("] as const;");
  lines.push("");

  return lines.join("\n");
}

function buildPrismaSchemaContent(input: ParsedInput): string {
  const provider = input.database === "sqlite" ? "sqlite" : "postgresql";
  const lines: string[] = [
    "// Deterministic db-schema output for Prisma ORM.",
    "generator client {",
    '  provider = "prisma-client-js"',
    "}",
    "",
    "datasource db {",
    `  provider = "${provider}"`,
    '  url      = env("DATABASE_URL")',
    "}",
    "",
  ];

  const entityByName = new Map<string, EntitySpec>();
  for (const entity of input.entities) {
    entityByName.set(entity.name, entity);
  }

  for (const entity of input.entities) {
    lines.push(`model ${toPascalCase(entity.name)} {`);

    for (const field of entity.fields) {
      const prismaType = mapFieldTypeToPrisma(field.type);
      const optionalMarker = field.nullable ? "?" : "";
      const attributes: string[] = [];

      if (field.primaryKey) {
        attributes.push("@id");
        if (field.type.trim().toLowerCase() === "uuid") {
          attributes.push("@default(uuid())");
        }
      }

      if (field.unique) {
        attributes.push("@unique");
      }

      if (field.references) {
        const referencedModel = toPascalCase(field.references.entity);
        attributes.push(`@relation(fields: [${field.name}], references: [${field.references.field}])`);
        lines.push(`  ${field.name} ${prismaType}${optionalMarker} ${attributes.join(" ")}`.trimEnd());
        lines.push(`  ${toCamelCase(referencedModel)} ${referencedModel}${field.nullable ? "?" : ""}`);
        continue;
      }

      lines.push(`  ${field.name} ${prismaType}${optionalMarker} ${attributes.join(" ")}`.trimEnd());
    }

    lines.push("}");
    lines.push("");
  }

  for (const relationship of input.relationships) {
    if (relationship.type !== "many-to-many") {
      continue;
    }

    const fromEntity = entityByName.get(relationship.from);
    const toEntity = entityByName.get(relationship.to);
    if (!fromEntity || !toEntity) {
      throw new DbSchemaError("INPUT_INVALID", `relationship references missing entity for junction model ${relationship.junctionTable}`);
    }

    const fromPrimary = getPrimaryKeyField(fromEntity);
    const toPrimary = getPrimaryKeyField(toEntity);
    const fromModel = toPascalCase(fromEntity.name);
    const toModel = toPascalCase(toEntity.name);
    const junctionModel = toPascalCase(relationship.junctionTable);
    const fromField = `${toCamelCase(singularize(relationship.from))}Id`;
    const toField = `${toCamelCase(singularize(relationship.to))}Id`;

    lines.push(`model ${junctionModel} {`);
    lines.push(`  ${fromField} ${mapFieldTypeToPrisma(fromPrimary.type)}`);
    lines.push(`  ${toField} ${mapFieldTypeToPrisma(toPrimary.type)}`);
    lines.push(`  ${toCamelCase(fromModel)} ${fromModel} @relation(fields: [${fromField}], references: [${fromPrimary.name}])`);
    lines.push(`  ${toCamelCase(toModel)} ${toModel} @relation(fields: [${toField}], references: [${toPrimary.name}])`);
    lines.push(`  @@id([${fromField}, ${toField}])`);
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function buildMigrationContent(input: ParsedInput): string {
  const entityByName = new Map<string, EntitySpec>();
  for (const entity of input.entities) {
    entityByName.set(entity.name, entity);
  }

  const statements: string[] = ["-- Deterministic migration generated by db-schema agent", ""];

  for (const entity of input.entities) {
    const columnLines = entity.fields.map((field) => {
      const tokens = [quoteSqlIdentifier(field.name), mapFieldTypeToSql(field.type, input.database)];
      if (!field.nullable) {
        tokens.push("NOT NULL");
      }
      if (field.unique) {
        tokens.push("UNIQUE");
      }
      if (field.primaryKey) {
        tokens.push("PRIMARY KEY");
      }
      if (field.references) {
        tokens.push(
          `REFERENCES ${quoteSqlIdentifier(field.references.entity)}(${quoteSqlIdentifier(field.references.field)})`,
        );
      }
      return `  ${tokens.join(" ")}`;
    });

    statements.push(`CREATE TABLE ${quoteSqlIdentifier(entity.name)} (`);
    statements.push(columnLines.join(",\n"));
    statements.push(");");
    statements.push("");
  }

  for (const relationship of input.relationships) {
    if (relationship.type !== "many-to-many") {
      continue;
    }

    const fromEntity = entityByName.get(relationship.from);
    const toEntity = entityByName.get(relationship.to);
    if (!fromEntity || !toEntity) {
      throw new DbSchemaError("INPUT_INVALID", `relationship references missing entity for migration junction ${relationship.junctionTable}`);
    }

    const fromPrimary = getPrimaryKeyField(fromEntity);
    const toPrimary = getPrimaryKeyField(toEntity);
    const fromColumn = `${toIdentifier(singularize(relationship.from))}_id`;
    const toColumn = `${toIdentifier(singularize(relationship.to))}_id`;

    statements.push(`CREATE TABLE ${quoteSqlIdentifier(relationship.junctionTable)} (`);
    statements.push(`  ${quoteSqlIdentifier(fromColumn)} ${mapFieldTypeToSql(fromPrimary.type, input.database)} NOT NULL,`);
    statements.push(`  ${quoteSqlIdentifier(toColumn)} ${mapFieldTypeToSql(toPrimary.type, input.database)} NOT NULL,`);
    statements.push(`  PRIMARY KEY (${quoteSqlIdentifier(fromColumn)}, ${quoteSqlIdentifier(toColumn)}),`);
    statements.push(
      `  FOREIGN KEY (${quoteSqlIdentifier(fromColumn)}) REFERENCES ${quoteSqlIdentifier(fromEntity.name)}(${quoteSqlIdentifier(fromPrimary.name)}),`,
    );
    statements.push(
      `  FOREIGN KEY (${quoteSqlIdentifier(toColumn)}) REFERENCES ${quoteSqlIdentifier(toEntity.name)}(${quoteSqlIdentifier(toPrimary.name)})`,
    );
    statements.push(");");
    statements.push("");
  }

  return statements.join("\n");
}

function buildSeedContent(input: ParsedInput): string | undefined {
  if (!input.seedData) {
    return undefined;
  }

  return [
    "// Deterministic seed payload generated by db-schema agent.",
    `export const seedData = ${JSON.stringify(input.seedData, null, 2)} as const;`,
    "",
  ].join("\n");
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

function toContractFileSpec(file: GeneratedFile, purpose: string, orm: OrmKind): FileSpec {
  return {
    path: file.path,
    purpose,
    techStack: {
      language: "typescript",
      framework: orm,
    },
  };
}

function buildGeneratedArtifacts(input: ParsedInput): {
  schemaFiles: GeneratedFile[];
  migrationFiles: GeneratedFile[];
  seedFile?: GeneratedFile;
  fileSpecs: FileSpec[];
} {
  if (input.orm === "drizzle") {
    const schemaFile = createGeneratedFile(input.outputDir, "drizzle/schema.ts", buildDrizzleSchemaContent(input));
    const migrationFile = createGeneratedFile(
      input.outputDir,
      "drizzle/migrations/0001_initial.sql",
      buildMigrationContent(input),
    );
    const seedContent = buildSeedContent(input);
    const seedFile = seedContent ? createGeneratedFile(input.outputDir, "drizzle/seed.ts", seedContent) : undefined;

    const fileSpecs: FileSpec[] = [
      toContractFileSpec(schemaFile, "Drizzle schema definitions", input.orm),
      toContractFileSpec(migrationFile, "Drizzle SQL migration", input.orm),
    ];

    if (seedFile) {
      fileSpecs.push(toContractFileSpec(seedFile, "Database seed file", input.orm));
    }

    return {
      schemaFiles: [schemaFile],
      migrationFiles: [migrationFile],
      seedFile,
      fileSpecs,
    };
  }

  if (input.orm === "prisma") {
    const schemaFile = createGeneratedFile(input.outputDir, "prisma/schema.prisma", buildPrismaSchemaContent(input));
    const migrationFile = createGeneratedFile(
      input.outputDir,
      "prisma/migrations/0001_initial/migration.sql",
      buildMigrationContent(input),
    );
    const seedContent = buildSeedContent(input);
    const seedFile = seedContent ? createGeneratedFile(input.outputDir, "prisma/seed.ts", seedContent) : undefined;

    const fileSpecs: FileSpec[] = [
      toContractFileSpec(schemaFile, "Prisma schema", input.orm),
      toContractFileSpec(migrationFile, "Prisma SQL migration", input.orm),
    ];

    if (seedFile) {
      fileSpecs.push(toContractFileSpec(seedFile, "Database seed file", input.orm));
    }

    return {
      schemaFiles: [schemaFile],
      migrationFiles: [migrationFile],
      seedFile,
      fileSpecs,
    };
  }

  throw new DbSchemaError("UNSUPPORTED_STACK", `unsupported orm: ${input.orm}`);
}

function recoveryForError(code: DbSchemaErrorCode): DbSchemaRecovery {
  if (code === "INPUT_INVALID") {
    return {
      action: "retry_modified",
      rationale: "Input data model is invalid; retry with a schema-compliant payload.",
    };
  }

  if (code === "SCOPE_VIOLATION") {
    return {
      action: "retry_modified",
      rationale: "Generated paths must stay inside outputDir; retry with corrected relative output paths.",
    };
  }

  if (code === "COMPILE_VALIDATION_FAILED") {
    return {
      action: "retry_modified",
      rationale: "Generated TypeScript failed noEmit validation; retry with compile-safe schema output.",
    };
  }

  if (code === "UNSUPPORTED_STACK") {
    return {
      action: "escalate",
      rationale: "Requested ORM or database is unsupported; escalate stack selection to operator.",
    };
  }

  return {
    action: "escalate",
    rationale: "Unexpected db-schema generation failure; escalate to operator.",
  };
}

function buildFailureEvent(
  correlationId: string,
  code: DbSchemaErrorCode,
  message: string,
  recoveryAction: RecoveryAction,
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    eventName: "db-schema.failed",
    eventVersion: "v1",
    occurredAt: nowIso(),
    correlationId,
    payload: {
      agent: AGENT_NAME,
      error: {
        code,
        message,
      },
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

function toDbSchemaError(error: unknown): { code: DbSchemaErrorCode; message: string } {
  if (error instanceof DbSchemaError) {
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

async function runImpl(input: DbSchemaInput): Promise<DbSchemaOutput> {
  const parsedInput = parseInput(input);
  const generated = buildGeneratedArtifacts(parsedInput);
  const filesToCompile = [...generated.schemaFiles, ...(generated.seedFile ? [generated.seedFile] : [])];
  validateTypeScriptCompilation(filesToCompile);

  return {
    schemaFiles: generated.schemaFiles,
    migrationFiles: generated.migrationFiles,
    seedFile: generated.seedFile,
    runtimeEvents: [],
  };
}

export async function run(input: DbSchemaInput): Promise<AgentResult<DbSchemaOutput>> {
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
    const { code, message } = toDbSchemaError(error);
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
        schemaFiles: [],
        migrationFiles: [],
        runtimeEvents: [runtimeEvent],
        recovery,
      },
    };
  }
}
