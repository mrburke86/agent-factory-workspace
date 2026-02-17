#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function die(msg: string, code = 1) {
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

function repoRoot() {
  // assumes running from workspace root or within it
  // detect by presence of pnpm-workspace.yaml
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

Examples:
  pnpm af agent:new retrieval-smoke
`);
}

function version() {
  console.log("0.1.0");
}

function agentNew(nameRaw: string) {
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
    entry: "./dist/index.js"
  };

  writeFileSync(join(baseDir, "agent.json"), JSON.stringify(agentJson, null, 2) + "\n", "utf8");

  writeFileSync(join(baseDir, "README.md"), `# ${name}

## Purpose
Describe what this agent does.

## Input / Output
- Input: JSON
- Output: JSON

## Local run
\`\`\`bash
pnpm -C services/agents/${name} build
\`\`\`
`, "utf8");

  writeFileSync(join(srcDir, "index.ts"), `export type AgentInput = Record<string, unknown>;
export type AgentOutput = Record<string, unknown>;

export async function run(input: AgentInput): Promise<AgentOutput> {
  return { ok: true, agent: "${name}", input };
}
`, "utf8");

  writeFileSync(join(baseDir, "tsconfig.json"), `{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS",
    "target": "ES2022",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`, "utf8");

  writeFileSync(join(baseDir, "package.json"), `{
  "name": "@acme/agent-${name}",
  "private": true,
  "version": "0.1.0",
  "type": "commonjs",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
`, "utf8");

  console.log(`✅ created services/agents/${name}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") return help();
  if (args[0] === "--version" || args[0] === "-v") return version();

  const [cmd, sub, name] = args;

  if (cmd === "agent:new") return agentNew(sub); // allow "agent:new <name>"
  if (cmd === "agent" && sub === "new") return agentNew(name); // allow "agent new <name>"

  die(`unknown command: ${args.join(" ")}`);
}

main().catch((e) => die(e?.message ?? String(e)));
