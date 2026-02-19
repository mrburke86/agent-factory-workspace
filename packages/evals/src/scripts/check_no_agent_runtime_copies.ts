import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function main() {
  const repoRoot = resolve(process.cwd(), "..", "..");
  const agentsDir = join(repoRoot, "services", "agents");

  if (!existsSync(agentsDir)) {
    fail(`missing agents directory: ${agentsDir}`);
  }

  const matches: string[] = [];
  const entries = readdirSync(agentsDir);

  for (const entry of entries) {
    const agentDir = join(agentsDir, entry);
    if (!statSync(agentDir).isDirectory()) continue;

    const candidate = join(agentDir, "src", "runtime.ts");
    if (existsSync(candidate)) {
      matches.push(relative(repoRoot, candidate).replaceAll("\\", "/"));
    }
  }

  if (matches.length > 0) {
    console.error("found forbidden per-agent runtime copies:");
    for (const p of matches) {
      console.error(` - ${p}`);
    }
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        event: "check_no_agent_runtime_copies.done",
        ok: true,
        matches: 0,
      },
      null,
      2,
    ),
  );
}

main();
