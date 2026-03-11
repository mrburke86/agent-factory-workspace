import { z } from "zod";

const NON_EMPTY = z.string().min(1);

export const ErrorClassSchema = z.enum([
  "BUILD_ERROR",
  "TEST_FAILURE",
  "SCHEMA_ERROR",
  "MISSING_FILE",
  "PATCH_FAILURE",
  "VALIDATION_FAILURE",
  "BUDGET_EXCEEDED",
  "DEPENDENCY_FAILED",
  "MAX_RETRIES",
  "RUNTIME_ERROR",
  "WIRING_ERROR",
]);

export type ErrorClass = z.infer<typeof ErrorClassSchema>;

/**
 * Consumed by:
 * - services/agents/error-recover
 * - services/agents/code-gen
 * - services/agents/auth-scaffold
 * - services/agents/payments-gen
 */
export const RecoveryActionSchema = z.enum(["retry_modified", "rollback", "skip_and_flag", "escalate"]);

export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

/**
 * Consumed by:
 * - services/agents/error-recover
 * - packages/evals/scripts/eval_error_recover.ts
 */
export const ErrorRecoverInputSchema = z.object({
  failedAgentId: NON_EMPTY,
  agentResult: z.record(z.unknown()),
  errorOutput: z.string(),
  attemptCount: z.number().int().nonnegative(),
  totalRetries: z.number().int().nonnegative(),
});

export type ErrorRecoverInput = z.infer<typeof ErrorRecoverInputSchema>;

/**
 * Consumed by:
 * - services/agents/error-recover
 * - packages/evals/scripts/eval_error_recover.ts
 */
export const ErrorRecoverOutputSchema = z.object({
  diagnosis: NON_EMPTY,
  errorClass: ErrorClassSchema,
  recoveryAction: RecoveryActionSchema,
  shouldRetry: z.boolean(),
  escalate: z.boolean(),
  modifiedInput: z.record(z.unknown()).optional(),
  rationale: NON_EMPTY,
});

export type ErrorRecoverOutput = z.infer<typeof ErrorRecoverOutputSchema>;

export const errorRecoverInputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/error-recover.input.schema.json",
  title: "ErrorRecoverInput",
  type: "object",
  additionalProperties: false,
  required: ["failedAgentId", "agentResult", "errorOutput", "attemptCount", "totalRetries"],
  properties: {
    failedAgentId: {
      type: "string",
      minLength: 1,
    },
    agentResult: {
      type: "object",
      additionalProperties: true,
    },
    errorOutput: {
      type: "string",
    },
    attemptCount: {
      type: "integer",
      minimum: 0,
    },
    totalRetries: {
      type: "integer",
      minimum: 0,
    },
  },
} as const;

export const errorRecoverOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/error-recover.output.schema.json",
  title: "ErrorRecoverOutput",
  type: "object",
  additionalProperties: false,
  required: ["diagnosis", "errorClass", "recoveryAction", "shouldRetry", "escalate", "rationale"],
  properties: {
    diagnosis: {
      type: "string",
      minLength: 1,
    },
    errorClass: {
      type: "string",
      enum: [
        "BUILD_ERROR",
        "TEST_FAILURE",
        "SCHEMA_ERROR",
        "MISSING_FILE",
        "PATCH_FAILURE",
        "VALIDATION_FAILURE",
        "BUDGET_EXCEEDED",
        "DEPENDENCY_FAILED",
        "MAX_RETRIES",
        "RUNTIME_ERROR",
        "WIRING_ERROR",
      ],
    },
    recoveryAction: {
      type: "string",
      enum: ["retry_modified", "rollback", "skip_and_flag", "escalate"],
    },
    shouldRetry: {
      type: "boolean",
    },
    escalate: {
      type: "boolean",
    },
    modifiedInput: {
      type: "object",
      additionalProperties: true,
    },
    rationale: {
      type: "string",
      minLength: 1,
    },
  },
} as const;
