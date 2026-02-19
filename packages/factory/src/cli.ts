#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function die(msg: string, code = 1): never {
  console.error(`af: ${msg}`);
  process.exit(code);
}

function kebabCase(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function repoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(cur, "pnpm-workspace.yaml");
    if (existsSync(candidate)) return cur;

    const parent = resolve(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  die("cannot locate repo root (pnpm-workspace.yaml not found)");
}

function help() {
  console.log(`
af - Agent Factory CLI

Usage:
  af --help
  af --version
  af agent:new <name>
  af agent:list
  af agent:run <name> [--input '<json>'] [--validate-input]
  af agent:validate <name>
  af agent:validate:all

Examples:
  pnpm af agent:new retrieval-smoke
  pnpm af agent:list
  pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}'
  pnpm af agent:validate retrieval-smoke
  pnpm af agent:validate:all
`);
}

function version() {
  console.log("0.1.0");
}

function agentNew(nameRaw?: string) {
  if (!nameRaw) die("missing <name>. Example: af agent:new retrieval-smoke");
  const name = kebabCase(nameRaw);
  if (!name) die("invalid name");

  const root = repoRoot();
  const baseDir = join(root, "services", "agents", name);

  const srcDir = join(baseDir, "src");

  if (existsSync(baseDir)) die(`agent already exists: services/agents/${name}`);

  mkdirSync(srcDir, { recursive: true });

  const agentJson = {
    id: name,
    name,
    version: "0.1.0",
    entry: "./dist/index.js",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        agent: { type: "string" },
        ms: { type: "number" },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
            required: ["code", "message"],
            additionalProperties: false,
          },
        },
      },
      required: ["ok", "agent", "ms", "errors"],
      additionalProperties: true,
    },
    capabilities: [],
  };

  writeFileSync(
    join(baseDir, "agent.json"),
    JSON.stringify(agentJson, null, 2) + "\n",
    "utf8",
  );

  writeFileSync(
    join(baseDir, "README.md"),
    `# ${name}

## Purpose
Describe what this agent does.

## Input / Output
- Input: JSON
- Output: JSON

## Local run
\`\`\`bash
pnpm -C services/agents/${name} build
\`\`\`
`,
    "utf8",
  );

  writeFileSync(
    join(srcDir, "index.ts"),
    `import { wrap, type AgentResult } from "@acme/agent-runtime";

export type AgentInput = Record<string, unknown>;
export type AgentData = Record<string, unknown>;

const AGENT_NAME = "${name}";

async function runImpl(input: AgentInput): Promise<AgentData> {
  return { input };
}

export async function run(input: AgentInput): Promise<AgentResult<AgentData>> {
  return wrap<AgentInput, AgentData>(AGENT_NAME, runImpl, input);
}
`,
    "utf8",
  );

  writeFileSync(
    join(baseDir, "tsconfig.json"),
    `{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,

    "outDir": "dist",
    "rootDir": "src",

    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",

    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
`,
    "utf8",
  );

  writeFileSync(
    join(baseDir, "package.json"),
    `{
  "name": "@acme/agent-${name}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@acme/agent-runtime": "workspace:*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
`,
    "utf8",
  );

  console.log(`✅ created services/agents/${name}`);
}

function parseInputJson(args: string[]): unknown {
  let value = "{}";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--input") {
      value = args[i + 1] ?? "";
      break;
    }
  }

  try {
    return JSON.parse(value);
  } catch {
    die("invalid --input JSON", 2);
  }
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function listAgents(root: string): string[] {
  const agentsDir = join(root, "services", "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function agentList() {
  const root = repoRoot();
  const names = listAgents(root);
  for (const name of names) {
    console.log(name);
  }
}

async function agentRun(nameRaw?: string, args: string[] = []) {
  if (!nameRaw) die("missing <name>. Example: af agent:run retrieval-smoke");
  const name = nameRaw.trim();
  if (!name) die("invalid agent name");

  const input = parseInputJson(args);
  const validateInput = hasFlag(args, "--validate-input");
  const { loadManifest, runAgent, validateInputAgainstSchema, validateManifest } = await import("@acme/agent-runner");

  if (validateInput) {
    let manifest: any;
    try {
      manifest = loadManifest(name);
    } catch (e) {
      die((e as Error)?.message ?? String(e), 1);
    }

    const manifestValidation = validateManifest(manifest);
    if (!manifestValidation.ok) {
      die(`invalid agent manifest: ${manifestValidation.errors.join("; ")}`, 1);
    }

    const inputValidation = validateInputAgainstSchema(input, manifest.inputSchema);
    if (!inputValidation.ok) {
      console.log(
        JSON.stringify({
          event: "agent.run.done",
          agent: name,
          ok: false,
          result: {
            ok: false,
            errors: [
              {
                code: "INPUT_INVALID",
                message: inputValidation.errors.join("; "),
              },
            ],
          },
        }),
      );
      process.exit(2);
    }
  }

  let result: any;
  try {
    result = await runAgent(name, input);
  } catch (e) {
    die((e as Error)?.message ?? String(e), 1);
  }

  console.log(
    JSON.stringify({
      event: "agent.run.done",
      agent: name,
      ok: result?.ok === true,
      result,
    }),
  );

  process.exit(result?.ok === true ? 0 : 2);
}

async function agentValidate(nameRaw?: string) {
  if (!nameRaw) die("missing <name>. Example: af agent:validate retrieval-smoke");
  const name = nameRaw.trim();
  if (!name) die("invalid agent name");

  const { loadManifest, validateManifest } = await import("@acme/agent-runner");

  let ok = false;
  let errors: string[] = [];
  try {
    const manifest = loadManifest(name);
    const validation = validateManifest(manifest);
    ok = validation.ok;
    errors = validation.errors;
  } catch (e) {
    ok = false;
    errors = [(e as Error)?.message ?? String(e)];
  }

  console.log(
    JSON.stringify({
      event: "agent.validate.done",
      agent: name,
      ok,
      errors,
    }),
  );

  process.exit(ok ? 0 : 2);
}

async function agentValidateAll() {
  const root = repoRoot();
  const names = listAgents(root).filter((name) => name !== "_shared");
  const { loadManifest, validateManifest } = await import("@acme/agent-runner");

  const failed: Array<{ agent: string; errors: string[] }> = [];
  for (const name of names) {
    try {
      const manifest = loadManifest(name, root);
      const validation = validateManifest(manifest);
      if (!validation.ok) {
        failed.push({ agent: name, errors: validation.errors });
      }
    } catch (e) {
      failed.push({ agent: name, errors: [(e as Error)?.message ?? String(e)] });
    }
  }

  const ok = failed.length === 0;
  console.log(
    JSON.stringify({
      event: "agent.validate_all.done",
      ok,
      count: names.length,
      failed,
    }),
  );

  process.exit(ok ? 0 : 2);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h")
    return help();
  if (args[0] === "--version" || args[0] === "-v") return version();

  const [cmd, sub, name] = args;

  if (cmd === "agent:new") return agentNew(sub); // allow "agent:new <name>"
  if (cmd === "agent" && sub === "new") return agentNew(name); // allow "agent new <name>"
  if (cmd === "agent:list") return agentList();
  if (cmd === "agent" && sub === "list") return agentList();
  if (cmd === "agent:run") return agentRun(sub, args.slice(2));
  if (cmd === "agent" && sub === "run") return agentRun(name, args.slice(3));
  if (cmd === "agent:validate") return agentValidate(sub);
  if (cmd === "agent" && sub === "validate") return agentValidate(name);
  if (cmd === "agent:validate:all") return agentValidateAll();
  if (cmd === "agent" && sub === "validate:all") return agentValidateAll();

  die(`unknown command: ${args.join(" ")}`);
}

main().catch((e) => die(e?.message ?? String(e)));
