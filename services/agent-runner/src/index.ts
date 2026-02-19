import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonSchemaType = "object" | "string" | "number" | "boolean" | "array";
type JsonSchemaSubset = {
  type: JsonSchemaType;
  properties?: Record<string, JsonSchemaSubset>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaSubset;
};

export type AgentManifest = {
  id: string;
  name: string;
  version: string;
  entry: string;
  inputSchema: JsonSchemaSubset;
  outputSchema: JsonSchemaSubset;
  capabilities?: string[];
};

type ValidationResult = { ok: boolean; errors: string[] };

function findRepoRoot(startDir: string): string {
  let cur = resolve(startDir);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(cur, "pnpm-workspace.yaml"))) return cur;
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("cannot locate repo root (pnpm-workspace.yaml not found)");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSchemaNode(
  schema: unknown,
  path: string,
  errors: string[],
  requireObjectType = true,
): void {
  if (!isRecord(schema)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const allowedTypes = new Set(["object", "string", "number", "boolean", "array"]);
  if (typeof schema.type !== "string" || !allowedTypes.has(schema.type)) {
    errors.push(`${path}.type must be one of: object, string, number, boolean, array`);
    return;
  }

  if (requireObjectType && schema.type !== "object") {
    errors.push(`${path}.type must be "object"`);
  }

  if (schema.type === "object") {
    if (!isRecord(schema.properties)) {
      errors.push(`${path}.properties must be an object`);
      return;
    }

    const properties = schema.properties as Record<string, unknown>;
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((v) => typeof v !== "string")) {
        errors.push(`${path}.required must be an array of strings`);
      } else {
        for (const requiredName of schema.required) {
          if (!(requiredName in properties)) {
            errors.push(`${path}.required contains "${requiredName}" but it is not defined in properties`);
          }
        }
      }
    }

    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== "boolean"
    ) {
      errors.push(`${path}.additionalProperties must be boolean when provided`);
    }

    for (const [propName, propSchema] of Object.entries(properties)) {
      validateSchemaNode(propSchema, `${path}.properties.${propName}`, errors, false);
    }
    return;
  }

  if (schema.type === "array") {
    if (!isRecord(schema.items)) {
      errors.push(`${path}.items must be an object when type is "array"`);
      return;
    }
    validateSchemaNode(schema.items, `${path}.items`, errors, false);
    return;
  }

  if (schema.properties !== undefined) {
    errors.push(`${path}.properties is only valid when type is "object"`);
  }
  if (schema.required !== undefined) {
    errors.push(`${path}.required is only valid when type is "object"`);
  }
  if (schema.additionalProperties !== undefined) {
    errors.push(`${path}.additionalProperties is only valid when type is "object"`);
  }
  if (schema.items !== undefined) {
    errors.push(`${path}.items is only valid when type is "array"`);
  }
}

export function validateManifest(manifest: any): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  for (const key of ["id", "name", "version", "entry"] as const) {
    if (typeof manifest[key] !== "string" || manifest[key].length === 0) {
      errors.push(`"${key}" must be a non-empty string`);
    }
  }

  if (!isRecord(manifest.inputSchema)) {
    errors.push(`"inputSchema" must be an object`);
  } else {
    validateSchemaNode(manifest.inputSchema, "inputSchema", errors, true);
  }

  if (!isRecord(manifest.outputSchema)) {
    errors.push(`"outputSchema" must be an object`);
  } else {
    validateSchemaNode(manifest.outputSchema, "outputSchema", errors, true);
  }

  if (
    manifest.capabilities !== undefined &&
    (!Array.isArray(manifest.capabilities) || manifest.capabilities.some((v: unknown) => typeof v !== "string"))
  ) {
    errors.push(`"capabilities" must be an array of strings when provided`);
  }

  return { ok: errors.length === 0, errors };
}

function validateValueAgainstSchema(
  value: unknown,
  schema: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(schema) || typeof schema.type !== "string") {
    errors.push(`${path} has invalid schema`);
    return;
  }

  const type = schema.type;
  if (type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be string`);
    return;
  }
  if (type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) errors.push(`${path} must be number`);
    return;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path} must be boolean`);
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be array`);
      return;
    }
    const itemSchema = schema.items;
    if (isRecord(itemSchema)) {
      value.forEach((item, idx) => {
        validateValueAgainstSchema(item, itemSchema, `${path}[${idx}]`, errors);
      });
    }
    return;
  }
  if (type === "object") {
    if (!isRecord(value)) {
      errors.push(`${path} must be object`);
      return;
    }

    const properties = isRecord(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((k): k is string => typeof k === "string")
      : [];
    const additionalProperties =
      typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : true;

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }

    for (const [key, propValue] of Object.entries(value)) {
      const propSchema = properties[key];
      if (propSchema === undefined) {
        if (!additionalProperties) {
          errors.push(`${path}.${key} is not allowed`);
        }
        continue;
      }
      validateValueAgainstSchema(propValue, propSchema, `${path}.${key}`, errors);
    }
    return;
  }

  errors.push(`${path} has unsupported schema type "${type}"`);
}

export function validateInputAgainstSchema(input: any, schema: any): ValidationResult {
  const errors: string[] = [];
  validateValueAgainstSchema(input, schema, "input", errors);
  return { ok: errors.length === 0, errors };
}

function parseManifest(raw: string, manifestPath: string): AgentManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `invalid agent.json at ${manifestPath}: ${(e as Error)?.message ?? String(e)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`invalid agent.json at ${manifestPath}: expected object`);
  }

  const validation = validateManifest(parsed);
  if (!validation.ok) {
    throw new Error(`invalid agent.json at ${manifestPath}: ${validation.errors.join("; ")}`);
  }

  return parsed as AgentManifest;
}

export function loadManifest(agentName: string, rootDir?: string): AgentManifest {
  const repoRoot = findRepoRoot(rootDir ?? process.cwd());
  const agentDir = join(repoRoot, "services", "agents", agentName);
  if (!existsSync(agentDir)) {
    throw new Error(`agent not found: services/agents/${agentName}`);
  }

  const manifestPath = join(agentDir, "agent.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`agent.json not found: services/agents/${agentName}/agent.json`);
  }

  const manifestRaw = readFileSync(manifestPath, "utf8");
  return parseManifest(manifestRaw, manifestPath);
}

export function resolveAgentEntryPath(manifest: AgentManifest, agentDir: string): string {
  return resolve(agentDir, manifest.entry);
}

export async function runAgent(
  agentName: string,
  input: unknown,
  opts?: { rootDir?: string },
): Promise<any> {
  const repoRoot = findRepoRoot(opts?.rootDir ?? process.cwd());
  const agentDir = join(repoRoot, "services", "agents", agentName);
  if (!existsSync(agentDir)) {
    throw new Error(`agent not found: services/agents/${agentName}`);
  }

  const manifest = loadManifest(agentName, repoRoot);
  const entryAbs = resolveAgentEntryPath(manifest, agentDir);
  if (!existsSync(entryAbs)) {
    throw new Error(`agent entry not found: ${entryAbs}`);
  }

  const mod = await import(pathToFileURL(entryAbs).href);
  if (typeof mod.run !== "function") {
    throw new Error(`agent module missing export run(): ${entryAbs}`);
  }

  return mod.run(input);
}
