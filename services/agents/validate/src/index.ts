import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { wrap, type AgentResult } from "@acme/agent-runtime";

const AGENT_NAME = "validate";
const MAX_OUTPUT_BYTES = 10_240;

export type AgentInput = {
  commands: string[];
  repoRoot: string;
  artifactDir: string;
};

type CommandExecutionResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type AgentData = {
  ok: boolean;
  results: CommandExecutionResult[];
  allPassed: boolean;
  error?: string;
};

type AllowlistVerdict =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter((token) => token.length > 0);
}

function isAllowlistedCommand(command: string): AllowlistVerdict {
  const tokens = splitCommand(command);
  if (tokens.length === 0) {
    return { ok: false, message: "command_not_allowlisted: empty command is not allowed" };
  }

  if (tokens[0] !== "pnpm") {
    return { ok: false, message: `command_not_allowlisted: '${command}' must start with 'pnpm'` };
  }

  if (tokens.length === 3 && tokens[1] === "-r" && tokens[2] === "build") {
    return { ok: true };
  }

  if (tokens.length === 2 && tokens[1] === "factory:health") {
    return { ok: true };
  }

  if (tokens.length === 4 && tokens[1] === "-C") {
    return { ok: true };
  }

  if (tokens.length >= 3 && tokens[1] === "af") {
    return { ok: true };
  }

  return {
    ok: false,
    message: `command_not_allowlisted: '${command}' does not match allowed pnpm command patterns`,
  };
}

function truncateOutput(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= MAX_OUTPUT_BYTES) {
    return value;
  }
  return bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
}

function writeCommandsLog(
  artifactDirAbs: string,
  results: CommandExecutionResult[],
  rejectionMessage?: string,
): void {
  mkdirSync(artifactDirAbs, { recursive: true });

  if (rejectionMessage) {
    writeFileSync(resolve(artifactDirAbs, "commands.log"), `${rejectionMessage}\n`, "utf8");
    return;
  }

  const content = results.map((result) => JSON.stringify(result)).join("\n");
  writeFileSync(resolve(artifactDirAbs, "commands.log"), content.length > 0 ? `${content}\n` : "", "utf8");
}

function executeCommand(command: string, repoRootAbs: string): CommandExecutionResult {
  const startedAt = Date.now();
  const completed =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
          cwd: repoRootAbs,
          encoding: "utf8",
          shell: false,
          windowsHide: true,
        })
      : (() => {
          const tokens = splitCommand(command);
          const executable = tokens[0];
          const args = tokens.slice(1);
          return spawnSync(executable, args, {
            cwd: repoRootAbs,
            encoding: "utf8",
            shell: false,
            windowsHide: true,
          });
        })();
  const finishedAt = Date.now();

  const stdout = truncateOutput(completed.stdout ?? "");
  const spawnErrorText = completed.error ? `spawn_error: ${completed.error.message}` : "";
  const combinedStderr = [completed.stderr ?? "", spawnErrorText].filter((part) => part.length > 0).join("\n");
  const stderr = truncateOutput(combinedStderr);

  return {
    command,
    exitCode: typeof completed.status === "number" ? completed.status : 1,
    stdout,
    stderr,
    durationMs: Math.max(0, finishedAt - startedAt),
  };
}

async function runImpl(input: AgentInput): Promise<AgentData> {
  const commands = Array.isArray(input.commands) ? input.commands : [];
  const repoRoot = typeof input.repoRoot === "string" ? input.repoRoot : ".";
  const artifactDir = typeof input.artifactDir === "string" ? input.artifactDir : ".factory";
  const repoRootAbs = resolve(process.cwd(), repoRoot);
  const artifactDirAbs = resolve(repoRootAbs, artifactDir);

  for (const command of commands) {
    const verdict = isAllowlistedCommand(command);
    if (!verdict.ok) {
      writeCommandsLog(artifactDirAbs, [], verdict.message);
      return {
        ok: false,
        results: [],
        allPassed: false,
        error: verdict.message,
      };
    }
  }

  const results: CommandExecutionResult[] = [];
  for (const command of commands) {
    results.push(executeCommand(command, repoRootAbs));
  }

  writeCommandsLog(artifactDirAbs, results);
  const allPassed = results.every((result) => result.exitCode === 0);
  return {
    ok: allPassed,
    results,
    allPassed,
  };
}

export async function run(input: AgentInput): Promise<AgentResult<AgentData>> {
  return wrap<AgentInput, AgentData>(AGENT_NAME, runImpl, input);
}
