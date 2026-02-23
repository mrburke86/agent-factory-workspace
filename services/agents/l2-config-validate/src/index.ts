import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wrap, type AgentResult } from "@acme/agent-runtime";
import { Layer2ConfigSchema, type Layer2Config } from "@acme/contracts";

const AGENT_NAME = "l2-config-validate";

export type AgentInput = {
  configPath: string;
};

export type AgentData = {
  ok: boolean;
  errors?: string[];
  validatedConfig?: Layer2Config;
};

function issuePath(path: Array<string | number>): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") {
      return `${acc}[${part}]`;
    }
    return acc === "$" ? `$.${part}` : `${acc}.${part}`;
  }, "$");
}

function readConfigJson(configPath: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  const resolvedPath = resolve(process.cwd(), configPath);
  let raw = "";
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      errors: [`configPath: unable to read '${configPath}': ${(error as Error).message}`],
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      errors: [`configPath: invalid JSON in '${configPath}': ${(error as Error).message}`],
    };
  }
}

function validateConfig(config: unknown): { ok: true; value: Layer2Config } | { ok: false; errors: string[] } {
  const parsed = Layer2ConfigSchema.safeParse(config);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`),
    };
  }

  return { ok: true, value: parsed.data };
}

async function runImpl(input: AgentInput): Promise<AgentData> {
  if (!input || typeof input.configPath !== "string" || input.configPath.trim().length === 0) {
    return {
      ok: false,
      errors: ["input.configPath must be a non-empty string"],
    };
  }

  const loaded = readConfigJson(input.configPath);
  if (!loaded.ok) {
    return {
      ok: false,
      errors: loaded.errors,
    };
  }

  const validated = validateConfig(loaded.value);
  if (!validated.ok) {
    return {
      ok: false,
      errors: validated.errors,
    };
  }

  return {
    ok: true,
    validatedConfig: validated.value,
  };
}

export async function run(input: AgentInput): Promise<AgentResult<AgentData>> {
  return wrap<AgentInput, AgentData>(AGENT_NAME, runImpl, input);
}
