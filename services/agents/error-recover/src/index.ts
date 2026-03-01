import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  ErrorRecoverInputSchema,
  ErrorRecoverOutputSchema,
  type ErrorClass,
  type ErrorRecoverInput,
  type ErrorRecoverOutput,
  type RecoveryAction,
} from "@acme/contracts";

const AGENT_NAME = "error-recover";

const RECOVERY_BY_CLASS: Record<ErrorClass, RecoveryAction> = {
  BUILD_ERROR: "retry_modified",
  TEST_FAILURE: "retry_modified",
  SCHEMA_ERROR: "retry_modified",
  MISSING_FILE: "retry_modified",
  PATCH_FAILURE: "rollback",
  VALIDATION_FAILURE: "retry_modified",
  BUDGET_EXCEEDED: "escalate",
  DEPENDENCY_FAILED: "skip_and_flag",
  MAX_RETRIES: "escalate",
  RUNTIME_ERROR: "escalate",
  WIRING_ERROR: "escalate",
};

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function classifyError(input: ErrorRecoverInput): ErrorClass {
  if (input.attemptCount >= 3 || input.totalRetries >= 10) {
    return "MAX_RETRIES";
  }

  const haystack = `${input.errorOutput}\n${stringify(input.agentResult)}`.toLowerCase();

  if (haystack.includes("budget exceeded") || haystack.includes("token budget")) {
    return "BUDGET_EXCEEDED";
  }

  if (
    haystack.includes("dependency failed") ||
    haystack.includes("blocked by upstream") ||
    haystack.includes("upstream task failed")
  ) {
    return "DEPENDENCY_FAILED";
  }

  if (
    haystack.includes("patch apply failed") ||
    haystack.includes("failed to apply patch") ||
    haystack.includes("hunk failed")
  ) {
    return "PATCH_FAILURE";
  }

  if (
    haystack.includes("enoent") ||
    haystack.includes("file not found") ||
    haystack.includes("no such file") ||
    haystack.includes("cannot find path") ||
    haystack.includes("missing file")
  ) {
    return "MISSING_FILE";
  }

  if (
    haystack.includes("schema validation") ||
    haystack.includes("schema mismatch") ||
    haystack.includes("invalid_type") ||
    haystack.includes("zoderror") ||
    haystack.includes("input validation failed")
  ) {
    return "SCHEMA_ERROR";
  }

  if (
    haystack.includes("validation gate failed") ||
    haystack.includes("agent validation failed") ||
    haystack.includes("acceptance criteria failed")
  ) {
    return "VALIDATION_FAILURE";
  }

  if (
    haystack.includes("assertion failed") ||
    haystack.includes("expected") ||
    haystack.includes("received") ||
    haystack.includes("exit code 2")
  ) {
    return "TEST_FAILURE";
  }

  if (
    haystack.includes("tsc") ||
    /\bts\d{4,}\b/.test(haystack) ||
    haystack.includes("type error") ||
    haystack.includes("typescript")
  ) {
    return "BUILD_ERROR";
  }

  if (
    haystack.includes("invalid manifest") ||
    haystack.includes("validatemanifest") ||
    haystack.includes("module not found") ||
    haystack.includes("cannot resolve module") ||
    haystack.includes("wiring")
  ) {
    return "WIRING_ERROR";
  }

  return "RUNTIME_ERROR";
}

function buildDiagnosis(errorClass: ErrorClass, failedAgentId: string): string {
  return `${failedAgentId} failed with ${errorClass}`;
}

function buildRationale(errorClass: ErrorClass, recoveryAction: RecoveryAction): string {
  switch (errorClass) {
    case "MAX_RETRIES":
      return "Retry caps are enforced globally, so this failure must escalate.";
    case "PATCH_FAILURE":
      return "Patch application must roll back before any further implementation attempt.";
    case "DEPENDENCY_FAILED":
      return "The task is blocked by an upstream dependency and should be skipped and flagged.";
    case "BUDGET_EXCEEDED":
      return "Budget exhaustion is non-recoverable inside the current pipeline run.";
    case "BUILD_ERROR":
    case "TEST_FAILURE":
    case "SCHEMA_ERROR":
    case "MISSING_FILE":
    case "VALIDATION_FAILURE":
      return "The failure is recoverable with a targeted retry using adjusted input.";
    case "WIRING_ERROR":
    case "RUNTIME_ERROR":
      return `The failure requires operator attention, so the agent will ${recoveryAction}.`;
    default:
      return `The agent will ${recoveryAction}.`;
  }
}

function buildModifiedInput(input: ErrorRecoverInput, errorClass: ErrorClass, recoveryAction: RecoveryAction): Record<string, unknown> | undefined {
  if (recoveryAction !== "retry_modified") {
    return undefined;
  }

  return {
    failedAgentId: input.failedAgentId,
    previousErrorClass: errorClass,
    previousAttemptCount: input.attemptCount,
    totalRetries: input.totalRetries,
    recoveryHint: `retry ${input.failedAgentId} with a focused fix for ${errorClass.toLowerCase()}`,
  };
}

async function runImpl(input: ErrorRecoverInput): Promise<ErrorRecoverOutput> {
  const parsed = ErrorRecoverInputSchema.parse(input);
  const errorClass = classifyError(parsed);
  const recoveryAction = RECOVERY_BY_CLASS[errorClass];
  const shouldRetry = recoveryAction === "retry_modified" && parsed.attemptCount < 3 && parsed.totalRetries < 10;
  const output: ErrorRecoverOutput = {
    diagnosis: buildDiagnosis(errorClass, parsed.failedAgentId),
    errorClass,
    recoveryAction,
    shouldRetry,
    escalate: recoveryAction === "escalate",
    modifiedInput: buildModifiedInput(parsed, errorClass, recoveryAction),
    rationale: buildRationale(errorClass, recoveryAction),
  };
  return ErrorRecoverOutputSchema.parse(output);
}

function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return {
      code: "UNHANDLED",
      message: error.message,
    };
  }

  return {
    code: "UNHANDLED",
    message: String(error),
  };
}

export async function run(input: ErrorRecoverInput): Promise<AgentResult<ErrorRecoverOutput>> {
  const startedAt = nowIso();
  const startedMs = Date.now();

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
    const errorInfo = toErrorInfo(error);
    return {
      ok: false,
      agent: AGENT_NAME,
      startedAt,
      finishedAt: nowIso(),
      ms: msBetween(startedMs, endedMs),
      errors: [
        {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      ],
    };
  }
}
