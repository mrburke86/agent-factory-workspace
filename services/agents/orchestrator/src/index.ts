import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadManifest, runAgent, validateInputAgainstSchema } from "@acme/agent-runner";
import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  ContextGatherOutputSchema,
  DecomposedTaskSchema,
  ErrorRecoverOutputSchema,
  Layer2ConfigSchema,
  OrchestratorInputSchema,
  OrchestratorOutputSchema,
  PipelineResultSchema,
  RepoPatchPatchItemSchema,
  RepoPatchPlanSchema,
  RepoPatchResultSchema,
  StageResultSchema,
  type OrchestratorInput,
  type OrchestratorOutput,
  type PipelineResult,
  type StageResult,
} from "@acme/contracts";

const AGENT_NAME = "orchestrator";
const STAGE_ORDER = ["context-gather", "plan", "repo-patch", "validate", "git-pr"] as const;

type StageName = (typeof STAGE_ORDER)[number];
type StageRunner = (input: unknown) => Promise<unknown>;
type StageRunners = Record<string, StageRunner>;
type zodInfer<TSchema extends { parse(value: unknown): unknown }> = ReturnType<TSchema["parse"]>;

type ValidateStageOutput = {
  ok: boolean;
  results: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>;
  allPassed: boolean;
  error?: string;
};

type GitPrStageOutput = {
  commands: string[];
  executed: boolean;
  branchName: string;
};

type StageState = {
  contextGather?: zodInfer<typeof ContextGatherOutputSchema>;
  plan?: zodInfer<typeof RepoPatchPlanSchema>;
  repoPatch?: zodInfer<typeof RepoPatchResultSchema>;
  validate?: ValidateStageOutput;
  gitPr?: GitPrStageOutput;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentResult(value: unknown): value is AgentResult<unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.agent === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    typeof value.ms === "number" &&
    Array.isArray(value.errors) &&
    typeof value.ok === "boolean"
  );
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendArtifactPath(paths: string[], filePath: string): void {
  if (!paths.includes(filePath)) {
    paths.push(filePath);
  }
}

function extractAgentError(value: unknown): string {
  if (isAgentResult(value)) {
    const firstError = value.errors.find((entry) => typeof entry?.message === "string");
    if (typeof firstError?.message === "string") {
      return firstError.message;
    }
    return `${value.agent} returned ok=false`;
  }

  if (isRecord(value) && Array.isArray(value.errors)) {
    const firstError = value.errors.find((entry) => isRecord(entry) && typeof entry.message === "string");
    if (isRecord(firstError) && typeof firstError.message === "string") {
      return firstError.message;
    }
  }

  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }

  return "unknown stage failure";
}

function stripOptionalOk(value: unknown): unknown {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return value;
  }

  const { ok: _ok, ...rest } = value;
  return rest;
}

function validateManifestOutput(stageName: StageName, data: unknown): void {
  const manifest = loadManifest(stageName);
  const validation = validateInputAgainstSchema(data, manifest.outputSchema);
  if (!validation.ok) {
    throw new Error(`${stageName} output failed manifest validation: ${validation.errors.join("; ")}`);
  }
}

function validateValidateStageOutput(value: unknown): ValidateStageOutput {
  if (!isRecord(value)) {
    throw new Error("validate output must be an object");
  }

  if (typeof value.ok !== "boolean") {
    throw new Error("validate output missing ok");
  }

  if (typeof value.allPassed !== "boolean") {
    throw new Error("validate output missing allPassed");
  }

  if (!Array.isArray(value.results)) {
    throw new Error("validate output missing results[]");
  }

  for (const item of value.results) {
    if (!isRecord(item)) {
      throw new Error("validate output contains a non-object result entry");
    }
    if (
      typeof item.command !== "string" ||
      typeof item.exitCode !== "number" ||
      typeof item.stdout !== "string" ||
      typeof item.stderr !== "string" ||
      typeof item.durationMs !== "number"
    ) {
      throw new Error("validate output contains an invalid result entry");
    }
  }

  if (value.error !== undefined && typeof value.error !== "string") {
    throw new Error("validate output error must be a string");
  }

  return {
    ok: value.ok,
    results: value.results as ValidateStageOutput["results"],
    allPassed: value.allPassed,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function validateGitPrStageOutput(value: unknown): GitPrStageOutput {
  if (!isRecord(value)) {
    throw new Error("git-pr output must be an object");
  }

  if (!Array.isArray(value.commands) || value.commands.some((entry) => typeof entry !== "string")) {
    throw new Error("git-pr output missing commands[]");
  }

  if (typeof value.executed !== "boolean") {
    throw new Error("git-pr output missing executed");
  }

  if (typeof value.branchName !== "string" || value.branchName.length === 0) {
    throw new Error("git-pr output missing branchName");
  }

  return {
    commands: value.commands as string[],
    executed: value.executed,
    branchName: value.branchName,
  };
}

function normalizeStageData(stageName: StageName, rawValue: unknown): unknown {
  if (isAgentResult(rawValue)) {
    if (!rawValue.ok) {
      throw new Error(extractAgentError(rawValue));
    }
    if (rawValue.data === undefined) {
      throw new Error(`${stageName} returned no data`);
    }
    return rawValue.data;
  }

  if (isRecord(rawValue) && typeof rawValue.ok === "boolean" && rawValue.ok === false) {
    throw new Error(extractAgentError(rawValue) || `${stageName} returned ok=false`);
  }

  return rawValue;
}

function validateStageOutput(stageName: StageName, rawValue: unknown): unknown {
  const data = normalizeStageData(stageName, rawValue);

  switch (stageName) {
    case "context-gather": {
      const candidate = stripOptionalOk(data);
      validateManifestOutput(stageName, candidate);
      return ContextGatherOutputSchema.parse(candidate);
    }
    case "plan": {
      const candidate = stripOptionalOk(data);
      validateManifestOutput(stageName, candidate);
      return RepoPatchPlanSchema.parse(candidate);
    }
    case "repo-patch": {
      const parsed = RepoPatchResultSchema.parse(data);
      if (!parsed.ok || parsed.errors.length > 0) {
        const firstError = parsed.errors[0]?.message ?? "repo-patch reported failure";
        throw new Error(firstError);
      }
      return parsed;
    }
    case "validate": {
      validateManifestOutput(stageName, data);
      const parsed = validateValidateStageOutput(data);
      if (!parsed.ok || !parsed.allPassed) {
        throw new Error(parsed.error ?? "validation gate failed");
      }
      return parsed;
    }
    case "git-pr": {
      const candidate = stripOptionalOk(data);
      validateManifestOutput(stageName, candidate);
      return validateGitPrStageOutput(candidate);
    }
    default:
      throw new Error(`unsupported stage: ${String(stageName)}`);
  }
}

function getTokenCount(stageName: StageName, value: unknown): number {
  if (stageName === "context-gather" && isRecord(value) && typeof value.tokenEstimate === "number") {
    return Math.max(0, Math.floor(value.tokenEstimate));
  }

  if (isRecord(value) && typeof value.tokenCount === "number") {
    return Math.max(0, Math.floor(value.tokenCount));
  }

  return 0;
}

function buildPlanTask(task: zodInfer<typeof DecomposedTaskSchema>) {
  return {
    taskId: task.id,
    goal: `${task.title}: ${task.description}`,
    constraints: [] as string[],
    fileScope: task.fileScope,
    mode: "validate" as const,
  };
}

function extractRepoPatchOutputValue(repoPatch: zodInfer<typeof RepoPatchResultSchema>, key: string): unknown {
  const match = repoPatch.outputs.find((entry) => entry.key === key);
  return match?.value;
}

function buildValidateInput(
  state: StageState,
  repoRoot: string,
  artifactBase: string,
): { commands: string[]; repoRoot: string; artifactDir: string } {
  const fromRepoPatch = state.repoPatch ? extractRepoPatchOutputValue(state.repoPatch, "plan") : undefined;
  const resolvedPlan = fromRepoPatch ? RepoPatchPlanSchema.safeParse(fromRepoPatch) : null;
  const commands =
    resolvedPlan?.success === true
      ? resolvedPlan.data.commands
      : state.plan?.commands ?? ["pnpm -r build"];

  return {
    commands: commands.length > 0 ? commands : ["pnpm -r build"],
    repoRoot,
    artifactDir: artifactBase,
  };
}

function buildGitPrInput(
  task: zodInfer<typeof DecomposedTaskSchema>,
  state: StageState,
  repoRoot: string,
): {
  branchName: string;
  commitMessage: string;
  patchedFiles: string[];
  mode: "dry-run";
  repoRoot: string;
} {
  const rawPatches = state.repoPatch ? extractRepoPatchOutputValue(state.repoPatch, "patches") : undefined;
  const patchArray = Array.isArray(rawPatches)
    ? rawPatches
        .map((entry) => RepoPatchPatchItemSchema.safeParse(entry))
        .filter((result): result is { success: true; data: zodInfer<typeof RepoPatchPatchItemSchema> } => result.success)
        .map((result) => result.data.path)
    : [];

  return {
    branchName: `factory/${task.id}`,
    commitMessage: `feat: ${task.title}`.slice(0, 72),
    patchedFiles: patchArray,
    mode: "dry-run",
    repoRoot,
  };
}

function buildStageInput(
  stageName: StageName,
  task: zodInfer<typeof DecomposedTaskSchema>,
  repoRoot: string,
  artifactBase: string,
  state: StageState,
): unknown {
  switch (stageName) {
    case "context-gather":
      return {
        repoRoot,
        taskDescription: `${task.title}. ${task.description}`,
        maxFiles: Math.max(20, task.fileScope.length),
      };
    case "plan":
      return buildPlanTask(task);
    case "repo-patch":
      return buildPlanTask(task);
    case "validate":
      return buildValidateInput(state, repoRoot, artifactBase);
    case "git-pr":
      return buildGitPrInput(task, state, repoRoot);
    default:
      throw new Error(`unsupported stage: ${String(stageName)}`);
  }
}

function createRealStageRunner(stageName: string): StageRunner {
  return async (stageInput: unknown) => runAgent(stageName, stageInput);
}

function toStageRunners(value: OrchestratorInput["_stageRunners"]): StageRunners {
  if (!value || typeof value !== "object") {
    return {};
  }

  const stageRunners: StageRunners = {};
  for (const [key, runner] of Object.entries(value)) {
    if (typeof runner === "function") {
      stageRunners[key] = runner;
    }
  }

  return stageRunners;
}

function buildFailureOutput(
  correlationId: string,
  completedStages: string[],
  stageResults: StageResult[],
  artifactPaths: string[],
  tokenUsage: OrchestratorOutput["tokenUsage"],
  failedStage: string,
  retryCount: number,
): OrchestratorOutput {
  return OrchestratorOutputSchema.parse({
    pipelineResult: PipelineResultSchema.parse({
      ok: false,
      completedStages,
      failedStage,
      retryCount,
    }),
    stageResults,
    artifactPaths,
    tokenUsage,
    correlationId,
  });
}

function buildSuccessOutput(
  correlationId: string,
  completedStages: string[],
  stageResults: StageResult[],
  artifactPaths: string[],
  tokenUsage: OrchestratorOutput["tokenUsage"],
  retryCount: number,
): OrchestratorOutput {
  return OrchestratorOutputSchema.parse({
    pipelineResult: PipelineResultSchema.parse({
      ok: true,
      completedStages,
      retryCount,
    }),
    stageResults,
    artifactPaths,
    tokenUsage,
    correlationId,
  });
}

function storeStageState(stageName: StageName, state: StageState, value: unknown): void {
  if (stageName === "context-gather") {
    state.contextGather = value as zodInfer<typeof ContextGatherOutputSchema>;
    return;
  }
  if (stageName === "plan") {
    state.plan = value as zodInfer<typeof RepoPatchPlanSchema>;
    return;
  }
  if (stageName === "repo-patch") {
    state.repoPatch = value as zodInfer<typeof RepoPatchResultSchema>;
    return;
  }
  if (stageName === "validate") {
    state.validate = value as ValidateStageOutput;
    return;
  }
  state.gitPr = value as GitPrStageOutput;
}

function failureMessage(pipelineResult: PipelineResult): string {
  if (pipelineResult.failedStage) {
    return `pipeline failed at stage '${pipelineResult.failedStage}'`;
  }
  return "pipeline failed";
}

async function runImpl(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const parsed = OrchestratorInputSchema.parse(input);
  const task = DecomposedTaskSchema.parse(parsed.task);
  const l2Config = Layer2ConfigSchema.parse(parsed.l2Config);
  const repoRoot = resolve(parsed.repoRoot);
  const correlationId = randomUUID();
  const artifactBase = join(repoRoot, ".factory", "runs", correlationId);
  const artifactPaths: string[] = [];
  const stageResults: StageResult[] = [];
  const completedStages: string[] = [];
  const tokenUsage: OrchestratorOutput["tokenUsage"] = {
    perStage: {},
    total: 0,
  };
  const stageRunners = toStageRunners(input._stageRunners);
  const state: StageState = {};
  const attemptsByStage = new Map<string, number>();
  let totalRetries = 0;

  mkdirSync(artifactBase, { recursive: true });

  const taskPath = join(artifactBase, "task.json");
  writeJson(taskPath, task);
  appendArtifactPath(artifactPaths, taskPath);

  const l2ConfigPath = join(artifactBase, "l2-config.json");
  writeJson(l2ConfigPath, l2Config);
  appendArtifactPath(artifactPaths, l2ConfigPath);

  for (const stageName of STAGE_ORDER) {
    const stageArtifactPath = join(artifactBase, `${stageName}.json`);
    let stageCompleted = false;

    while (!stageCompleted) {
      const attempts = attemptsByStage.get(stageName) ?? 0;

      if (typeof parsed.tokenBudget === "number" && tokenUsage.total >= parsed.tokenBudget) {
        const budgetReport = {
          ok: false,
          error: `token budget exceeded before ${stageName}`,
          tokenBudget: parsed.tokenBudget,
          tokenUsage,
        };
        writeJson(stageArtifactPath, budgetReport);
        appendArtifactPath(artifactPaths, stageArtifactPath);
        stageResults.push(
          StageResultSchema.parse({
            stageName,
            ok: false,
            durationMs: 0,
            tokenCount: 0,
            outputPath: stageArtifactPath,
            error: budgetReport.error,
          }),
        );

        const resultPath = join(artifactBase, "result.json");
        appendArtifactPath(artifactPaths, resultPath);
        const failure = buildFailureOutput(
          correlationId,
          completedStages,
          stageResults,
          artifactPaths,
          tokenUsage,
          stageName,
          totalRetries,
        );
        writeJson(resultPath, failure);
        return failure;
      }

      const stageInput = buildStageInput(stageName, task, repoRoot, artifactBase, state);
      const runner = stageRunners[stageName] ?? createRealStageRunner(stageName);
      const startedMs = Date.now();

      try {
        attemptsByStage.set(stageName, attempts + 1);
        const rawValue = await runner(stageInput);
        const stageValue = validateStageOutput(stageName, rawValue);
        const durationMs = msBetween(startedMs, Date.now());
        const tokenCount = getTokenCount(stageName, stageValue);

        writeJson(stageArtifactPath, stageValue);
        appendArtifactPath(artifactPaths, stageArtifactPath);

        tokenUsage.perStage[stageName] = tokenCount;
        tokenUsage.total += tokenCount;
        storeStageState(stageName, state, stageValue);
        completedStages.push(stageName);
        stageResults.push(
          StageResultSchema.parse({
            stageName,
            ok: true,
            durationMs,
            tokenCount,
            outputPath: stageArtifactPath,
          }),
        );
        stageCompleted = true;
      } catch (error) {
        const durationMs = msBetween(startedMs, Date.now());
        const message = (error as Error)?.message ?? String(error);
        const failureArtifact = {
          ok: false,
          error: message,
          attemptCount: attempts + 1,
        };

        writeJson(stageArtifactPath, failureArtifact);
        appendArtifactPath(artifactPaths, stageArtifactPath);

        let recovery;
        try {
          const recoveryInput = {
            failedAgentId: stageName,
            agentResult: failureArtifact,
            errorOutput: message,
            attemptCount: attempts + 1,
            totalRetries,
          };
          const recoveryRunner = stageRunners["error-recover"] ?? createRealStageRunner("error-recover");
          const recoveryRawValue = await recoveryRunner(recoveryInput);
          const recoveryValue = isAgentResult(recoveryRawValue)
            ? recoveryRawValue.ok
              ? recoveryRawValue.data
              : undefined
            : recoveryRawValue;
          recovery = ErrorRecoverOutputSchema.parse(recoveryValue);
        } catch (recoveryError) {
          recovery = ErrorRecoverOutputSchema.parse({
            diagnosis: `${stageName} failed and error-recover could not run`,
            errorClass: "RUNTIME_ERROR",
            recoveryAction: "escalate",
            shouldRetry: false,
            escalate: true,
            rationale: (recoveryError as Error)?.message ?? String(recoveryError),
          });
        }

        const recoveryPath = join(artifactBase, `error-recover-${stageName}-${attempts + 1}.json`);
        writeJson(recoveryPath, recovery);
        appendArtifactPath(artifactPaths, recoveryPath);

        if (recovery.shouldRetry && attempts + 1 < 3 && totalRetries < 10) {
          totalRetries += 1;
          continue;
        }

        stageResults.push(
          StageResultSchema.parse({
            stageName,
            ok: false,
            durationMs,
            tokenCount: 0,
            outputPath: stageArtifactPath,
            error: `${message} | recovery: ${recovery.rationale}`,
          }),
        );

        const resultPath = join(artifactBase, "result.json");
        appendArtifactPath(artifactPaths, resultPath);
        const failure = buildFailureOutput(
          correlationId,
          completedStages,
          stageResults,
          artifactPaths,
          tokenUsage,
          stageName,
          totalRetries,
        );
        writeJson(resultPath, failure);
        return failure;
      }
    }
  }

  const resultPath = join(artifactBase, "result.json");
  appendArtifactPath(artifactPaths, resultPath);
  const success = buildSuccessOutput(
    correlationId,
    completedStages,
    stageResults,
    artifactPaths,
    tokenUsage,
    totalRetries,
  );
  writeJson(resultPath, success);
  return success;
}

function unhandledResult(
  startedAt: string,
  startedMs: number,
  error: unknown,
): AgentResult<OrchestratorOutput> {
  return {
    ok: false,
    agent: AGENT_NAME,
    startedAt,
    finishedAt: nowIso(),
    ms: msBetween(startedMs, Date.now()),
    errors: [
      {
        code: "UNHANDLED",
        message: (error as Error)?.message ?? String(error),
      },
    ],
  };
}

export async function run(input: OrchestratorInput): Promise<AgentResult<OrchestratorOutput>> {
  const startedAt = nowIso();
  const startedMs = Date.now();

  try {
    const data = await runImpl(input);
    const finishedAt = nowIso();

    if (data.pipelineResult.ok) {
      return {
        ok: true,
        agent: AGENT_NAME,
        startedAt,
        finishedAt,
        ms: msBetween(startedMs, Date.now()),
        errors: [],
        data,
      };
    }

    return {
      ok: false,
      agent: AGENT_NAME,
      startedAt,
      finishedAt,
      ms: msBetween(startedMs, Date.now()),
      errors: [
        {
          code: "PIPELINE_FAILED",
          message: failureMessage(data.pipelineResult),
        },
      ],
      data,
    };
  } catch (error) {
    return unhandledResult(startedAt, startedMs, error);
  }
}
