#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  af factory run --task "<text>" [--dry-run] [--scope <path>] [--mode <dry-run|validate|pr-ready>]

Examples:
  pnpm af agent:new retrieval-smoke
  pnpm af agent:list
  pnpm af agent:run retrieval-smoke --input '{"query":"refund policy","topK":5}'
  pnpm af agent:validate retrieval-smoke
  pnpm af agent:validate:all
  pnpm factory run --task "add hello.txt with content hello world" --scope hello.txt --mode validate
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

function optionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function optionValue(args: string[], name: string): string | undefined {
  return optionValues(args, name)[0];
}

function printFactoryResultAndExit(payload: Record<string, unknown>, code: 0 | 1 | 2): never {
  console.log(JSON.stringify(payload));
  process.exit(code);
}

type FactoryRunMode = "dry-run" | "validate" | "pr-ready";

function extractOutputByKey(result: unknown, key: string): unknown {
  if (!result || typeof result !== "object") return undefined;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const outputs = (data as { outputs?: unknown }).outputs;
  if (!Array.isArray(outputs)) return undefined;
  const match = outputs.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { key?: unknown }).key === key;
  });
  if (!match || typeof match !== "object") return undefined;
  return (match as { value?: unknown }).value;
}

function readRunArtifact(correlationId: string, artifactName: string): unknown {
  const artifactPath = join(process.cwd(), ".factory", "runs", correlationId, artifactName);
  if (!existsSync(artifactPath)) return undefined;
  try {
    return JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    return undefined;
  }
}

function deriveValidationPassed(correlationId: string): boolean | null {
  const validateArtifact = readRunArtifact(correlationId, "validate.json");
  if (!validateArtifact || typeof validateArtifact !== "object") return null;
  if ((validateArtifact as { skipped?: unknown }).skipped === true) return null;

  const allPassed = (validateArtifact as { data?: { allPassed?: unknown } }).data?.allPassed;
  if (typeof allPassed === "boolean") return allPassed;

  const dataOk = (validateArtifact as { data?: { ok?: unknown } }).data?.ok;
  if (typeof dataOk === "boolean") return dataOk;

  const wrapperOk = (validateArtifact as { ok?: unknown }).ok;
  if (typeof wrapperOk === "boolean" && wrapperOk === false) return false;

  return null;
}

function deriveGitCommands(correlationId: string): string[] {
  const gitArtifact = readRunArtifact(correlationId, "git-pr.json");
  if (!gitArtifact || typeof gitArtifact !== "object") return [];
  if ((gitArtifact as { skipped?: unknown }).skipped === true) return [];

  const wrappedCommands = (gitArtifact as { data?: { commands?: unknown } }).data?.commands;
  if (Array.isArray(wrappedCommands)) {
    return wrappedCommands.filter((entry): entry is string => typeof entry === "string");
  }

  const directCommands = (gitArtifact as { commands?: unknown }).commands;
  if (Array.isArray(directCommands)) {
    return directCommands.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

function isUsageOrWiringAgentFailure(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  if ((result as { ok?: unknown }).ok !== true) return true;

  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return true;

  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;

  return errors.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const code = (entry as { code?: unknown }).code;
    return code === "SUB_AGENT_INVOCATION_FAILED";
  });
}

async function factoryRun(args: string[] = []) {
  const taskText = optionValue(args, "--task") ?? optionValue(args, "-task");
  if (!taskText || taskText.trim().length === 0) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: null,
        ok: false,
        errors: [{ code: "USAGE", message: "missing --task <text>" }],
      },
      1,
    );
  }

  const rawScopes = [
    ...optionValues(args, "--scope"),
    ...optionValues(args, "-scope"),
  ];
  const fileScope = rawScopes
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (fileScope.length === 0) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: null,
        ok: false,
        errors: [{ code: "USAGE", message: "missing --scope <path>" }],
      },
      1,
    );
  }

  const dryRunFlag = hasFlag(args, "--dry-run") || hasFlag(args, "-dry-run");
  const modeValues = [...optionValues(args, "--mode"), ...optionValues(args, "-mode")]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (modeValues.length > 1) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: null,
        ok: false,
        errors: [{ code: "USAGE", message: "multiple --mode values are not supported" }],
      },
      1,
    );
  }

  let mode: FactoryRunMode = "validate";
  if (dryRunFlag) {
    mode = "dry-run";
  } else if (modeValues.length === 1) {
    const selectedMode = modeValues[0];
    if (selectedMode !== "dry-run" && selectedMode !== "validate" && selectedMode !== "pr-ready") {
      return printFactoryResultAndExit(
        {
          event: "factory.result",
          correlationId: null,
          ok: false,
          errors: [
            {
              code: "USAGE",
              message: "invalid --mode value (expected dry-run|validate|pr-ready)",
            },
          ],
        },
        1,
      );
    }
    mode = selectedMode;
  }

  const taskId = randomUUID();
  const task = {
    taskId,
    goal: taskText,
    constraints: [],
    fileScope,
    mode,
  };

  const { loadManifest, runAgent, validateInputAgainstSchema, validateManifest } = await import("@acme/agent-runner");

  let manifest: any;
  try {
    manifest = loadManifest("repo-patch");
  } catch (e) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: taskId,
        ok: false,
        errors: [{ code: "WIRING", message: (e as Error)?.message ?? String(e) }],
      },
      1,
    );
  }

  const manifestValidation = validateManifest(manifest);
  if (!manifestValidation.ok) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: taskId,
        ok: false,
        errors: [{ code: "WIRING", message: manifestValidation.errors.join("; ") }],
      },
      1,
    );
  }

  const inputValidation = validateInputAgainstSchema(task, manifest.inputSchema);
  if (!inputValidation.ok) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: taskId,
        ok: false,
        errors: [{ code: "INPUT_INVALID", message: inputValidation.errors.join("; ") }],
      },
      2,
    );
  }

  let result: any;
  try {
    result = await runAgent("repo-patch", task);
  } catch (e) {
    return printFactoryResultAndExit(
      {
        event: "factory.result",
        correlationId: taskId,
        ok: false,
        errors: [{ code: "WIRING", message: (e as Error)?.message ?? String(e) }],
      },
      1,
    );
  }

  const correlationId =
    typeof result?.data?.correlationId === "string" ? (result.data.correlationId as string) : taskId;

  const planValue = extractOutputByKey(result, "plan");
  const plan = {
    steps: Array.isArray((planValue as { steps?: unknown } | undefined)?.steps)
      ? ((planValue as { steps: unknown[] }).steps.length ?? 0)
      : 0,
    touchedFiles: Array.isArray((planValue as { touchedFiles?: unknown } | undefined)?.touchedFiles)
      ? (planValue as { touchedFiles: unknown[] }).touchedFiles.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };

  const patchesValue = extractOutputByKey(result, "patches");
  const patchCount = Array.isArray(patchesValue) ? patchesValue.length : 0;
  const validationPassed = deriveValidationPassed(correlationId);
  const gitCommands = mode === "pr-ready" ? deriveGitCommands(correlationId) : null;

  const ok = result?.ok === true && result?.data?.ok === true;
  const payload: Record<string, unknown> = {
    event: "factory.result",
    correlationId,
    ok,
    plan,
    patchCount,
    validationPassed,
    gitCommands,
  };

  const resultErrors = Array.isArray(result?.data?.errors)
    ? result.data.errors
    : Array.isArray(result?.errors)
      ? result.errors
      : [];
  if (!ok && resultErrors.length > 0) {
    payload.errors = resultErrors;
  }

  const exitCode: 0 | 1 | 2 = ok ? 0 : isUsageOrWiringAgentFailure(result) ? 1 : 2;
  printFactoryResultAndExit(payload, exitCode);
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
  if (cmd === "factory" && sub === "run") return factoryRun(args.slice(2));

  die(`unknown command: ${args.join(" ")}`);
}

main().catch((e) => die(e?.message ?? String(e)));
