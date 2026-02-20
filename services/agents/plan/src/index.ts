import { RepoPatchPlanSchema, RepoPatchTaskSchema, type RepoPatchPlan, type RepoPatchTask } from "@acme/contracts";
import { wrap, type AgentResult } from "@acme/agent-runtime";

const AGENT_NAME = "plan";
const BUILD_COMMAND = "pnpm -r build";

type ActionType = "create" | "modify" | "delete";

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "").trim();
}

function isPathInScope(targetPath: string, fileScope: string[]): boolean {
  const normalizedTarget = normalizePath(targetPath);
  for (const scopeEntry of fileScope) {
    const normalizedScope = normalizePath(scopeEntry);
    if (normalizedScope.length === 0) continue;
    if (normalizedTarget === normalizedScope) return true;
    if (normalizedScope.endsWith("/")) {
      if (normalizedTarget.startsWith(normalizedScope)) return true;
      continue;
    }
    if (normalizedTarget.startsWith(`${normalizedScope}/`)) return true;
  }
  return false;
}

function detectActionType(goal: string): ActionType {
  const lowered = goal.toLowerCase();
  const rawCandidates: Array<{ action: ActionType; index: number }> = [
    { action: "create", index: lowered.search(/\b(add|create|write)\b/) },
    { action: "modify", index: lowered.search(/\b(modify|update|change|edit)\b/) },
    { action: "delete", index: lowered.search(/\b(delete|remove)\b/) },
  ];
  const candidates = rawCandidates.filter((item) => item.index >= 0);

  if (candidates.length === 0) return "modify";
  candidates.sort((a, b) => a.index - b.index || a.action.localeCompare(b.action));
  return candidates[0].action;
}

function extractGoalFiles(goal: string): string[] {
  const files = new Set<string>();
  const fileLikePattern = /(?:^|[\s"'`])([A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)*\.[A-Za-z0-9._-]+)(?=$|[\s"',`])/g;
  let match: RegExpExecArray | null = fileLikePattern.exec(goal);
  while (match) {
    const normalized = normalizePath(match[1]);
    if (normalized.length > 0) files.add(normalized);
    match = fileLikePattern.exec(goal);
  }
  return Array.from(files).sort((a, b) => a.localeCompare(b));
}

function buildRisks(action: ActionType, touchedFiles: string[]): string[] {
  const risks: string[] = [];
  for (const touchedFile of touchedFiles) {
    if (action === "create") {
      risks.push(`writes new file: ${touchedFile}`);
      continue;
    }
    if (action === "delete") {
      risks.push(`deletes file: ${touchedFile}`);
      continue;
    }
    risks.push(`modifies existing file: ${touchedFile}`);
  }
  return risks.sort((a, b) => a.localeCompare(b));
}

function buildSteps(action: ActionType, touchedFiles: string[], mode: RepoPatchTask["mode"]): string[] {
  const actionVerb =
    action === "create"
      ? "create requested files"
      : action === "delete"
        ? "delete requested files"
        : "modify requested files";

  const fileSummary = touchedFiles.length > 0 ? touchedFiles.join(", ") : "(none)";
  const commandStep = mode === "dry-run" ? "skip command execution (dry-run)" : `run command: ${BUILD_COMMAND}`;

  return [
    `parse goal and infer action: ${action}`,
    `resolve touched files from goal and fileScope: ${fileSummary}`,
    actionVerb,
    commandStep,
  ];
}

function buildCommands(mode: RepoPatchTask["mode"]): string[] {
  if (mode === "dry-run") return [];
  return [BUILD_COMMAND];
}

function buildTouchedFiles(task: RepoPatchTask): string[] {
  const parsedFromGoal = extractGoalFiles(task.goal);
  if (parsedFromGoal.length > 0) return parsedFromGoal;
  return [...task.fileScope].map(normalizePath).filter((pathValue) => pathValue.length > 0).sort((a, b) => a.localeCompare(b));
}

function validateTouchedFilesInScope(touchedFiles: string[], fileScope: string[]): void {
  const violations = touchedFiles.filter((pathValue) => !isPathInScope(pathValue, fileScope));
  if (violations.length === 0) return;
  const details = violations.join(", ");
  throw new Error(`scope_violation: touched files out of scope: ${details}`);
}

async function runImpl(input: RepoPatchTask): Promise<RepoPatchPlan> {
  const task = RepoPatchTaskSchema.parse(input);
  const action = detectActionType(task.goal);
  const touchedFiles = buildTouchedFiles(task);
  validateTouchedFilesInScope(touchedFiles, task.fileScope);

  const plan = RepoPatchPlanSchema.parse({
    steps: buildSteps(action, touchedFiles, task.mode),
    touchedFiles,
    commands: buildCommands(task.mode),
    risks: buildRisks(action, touchedFiles),
  });

  return plan;
}

export async function run(input: RepoPatchTask): Promise<AgentResult<RepoPatchPlan>> {
  return wrap<RepoPatchTask, RepoPatchPlan>(AGENT_NAME, runImpl, input);
}
