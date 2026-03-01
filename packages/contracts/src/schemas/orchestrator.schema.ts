import { z } from "zod";

const NON_EMPTY = z.string().min(1);
const TaskStatusSchema = z.enum(["completed", "failed", "skipped"]);
const TokenUsageSchema = z.object({
  perStage: z.record(z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const StageResultSchema = z.object({
  stageName: NON_EMPTY,
  ok: z.boolean(),
  durationMs: z.number().nonnegative(),
  tokenCount: z.number().int().nonnegative(),
  outputPath: NON_EMPTY,
  error: NON_EMPTY.optional(),
});

export type StageResult = z.infer<typeof StageResultSchema>;

export const PipelineResultSchema = z.object({
  ok: z.boolean(),
  completedStages: z.array(NON_EMPTY),
  failedStage: NON_EMPTY.optional(),
  retryCount: z.number().int().nonnegative(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;

const OrchestratorSharedInputSchema = z.object({
  l2Config: z.record(z.unknown()),
  repoRoot: NON_EMPTY,
  tokenBudget: z.number().int().positive().optional(),
});

const SingleTaskOrchestratorInputSchema = OrchestratorSharedInputSchema.extend({
  task: z.record(z.unknown()),
  taskList: z.undefined().optional(),
}).passthrough();

const MultiTaskOrchestratorInputSchema = OrchestratorSharedInputSchema.extend({
  taskList: z.record(z.unknown()),
  task: z.undefined().optional(),
}).passthrough();

/**
 * Consumed by:
 * - services/agents/orchestrator
 * - packages/evals/scripts/eval_orchestrator_single.ts
 * - packages/evals/scripts/eval_orchestrator_recovery.ts
 * - packages/evals/scripts/eval_orchestrator_multi.ts
 */
export const OrchestratorInputSchema = z.union([
  SingleTaskOrchestratorInputSchema,
  MultiTaskOrchestratorInputSchema,
]);

export interface OrchestratorInput extends z.infer<typeof SingleTaskOrchestratorInputSchema> {
  _stageRunners?: Record<string, (input: unknown) => Promise<unknown>>;
}

export interface MultiTaskOrchestratorInput extends z.infer<typeof MultiTaskOrchestratorInputSchema> {
  _stageRunners?: Record<string, (input: unknown) => Promise<unknown>>;
}

/**
 * Consumed by:
 * - services/agents/orchestrator
 * - packages/evals/scripts/eval_orchestrator_single.ts
 * - packages/evals/scripts/eval_orchestrator_recovery.ts
 */
export const OrchestratorOutputSchema = z.object({
  pipelineResult: PipelineResultSchema,
  stageResults: z.array(StageResultSchema),
  artifactPaths: z.array(NON_EMPTY),
  tokenUsage: TokenUsageSchema,
  correlationId: NON_EMPTY,
});

export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;

export const TaskPipelineResultSchema = z.object({
  taskId: NON_EMPTY,
  ok: z.boolean(),
  status: TaskStatusSchema,
  skippedReason: NON_EMPTY.optional(),
  stageResults: z.array(StageResultSchema),
  tokenUsage: TokenUsageSchema,
  artifactPath: NON_EMPTY,
});

export type TaskPipelineResult = z.infer<typeof TaskPipelineResultSchema>;

export const MultiTaskOrchestratorOutputSchema = z.object({
  overallResult: z.object({
    ok: z.boolean(),
    completedTasks: z.array(NON_EMPTY),
    failedTasks: z.array(NON_EMPTY),
    skippedTasks: z.array(NON_EMPTY),
  }),
  taskResults: z.array(TaskPipelineResultSchema),
  artifactPaths: z.array(NON_EMPTY),
  tokenUsage: TokenUsageSchema,
  correlationId: NON_EMPTY,
});

export type MultiTaskOrchestratorOutput = z.infer<typeof MultiTaskOrchestratorOutputSchema>;
export type OrchestratorRunOutput = OrchestratorOutput | MultiTaskOrchestratorOutput;

export const orchestratorInputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/orchestrator.input.schema.json",
  title: "OrchestratorInput",
  type: "object",
  required: ["l2Config", "repoRoot"],
  anyOf: [
    {
      required: ["task"],
    },
    {
      required: ["taskList"],
    },
  ],
  properties: {
    task: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    l2Config: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    taskList: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    repoRoot: {
      type: "string",
      minLength: 1,
    },
    tokenBudget: {
      type: "number",
      minimum: 1,
    },
  },
  additionalProperties: true,
} as const;

export const orchestratorOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/orchestrator.output.schema.json",
  title: "OrchestratorOutput",
  type: "object",
  additionalProperties: false,
  required: ["artifactPaths", "tokenUsage", "correlationId"],
  anyOf: [
    {
      required: ["pipelineResult", "stageResults"],
    },
    {
      required: ["overallResult", "taskResults"],
    },
  ],
  properties: {
    pipelineResult: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "completedStages", "retryCount"],
      properties: {
        ok: {
          type: "boolean",
        },
        completedStages: {
          type: "array",
          items: {
            type: "string",
          },
        },
        failedStage: {
          type: "string",
          minLength: 1,
        },
        retryCount: {
          type: "number",
          minimum: 0,
        },
      },
    },
    overallResult: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "completedTasks", "failedTasks", "skippedTasks"],
      properties: {
        ok: {
          type: "boolean",
        },
        completedTasks: {
          type: "array",
          items: {
            type: "string",
          },
        },
        failedTasks: {
          type: "array",
          items: {
            type: "string",
          },
        },
        skippedTasks: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
    stageResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stageName", "ok", "durationMs", "tokenCount", "outputPath"],
        properties: {
          stageName: {
            type: "string",
            minLength: 1,
          },
          ok: {
            type: "boolean",
          },
          durationMs: {
            type: "number",
            minimum: 0,
          },
          tokenCount: {
            type: "number",
            minimum: 0,
          },
          outputPath: {
            type: "string",
            minLength: 1,
          },
          error: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
    taskResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "ok", "status", "stageResults", "tokenUsage", "artifactPath"],
        properties: {
          taskId: {
            type: "string",
            minLength: 1,
          },
          ok: {
            type: "boolean",
          },
          status: {
            type: "string",
            enum: ["completed", "failed", "skipped"],
          },
          skippedReason: {
            type: "string",
            minLength: 1,
          },
          stageResults: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["stageName", "ok", "durationMs", "tokenCount", "outputPath"],
              properties: {
                stageName: {
                  type: "string",
                  minLength: 1,
                },
                ok: {
                  type: "boolean",
                },
                durationMs: {
                  type: "number",
                  minimum: 0,
                },
                tokenCount: {
                  type: "number",
                  minimum: 0,
                },
                outputPath: {
                  type: "string",
                  minLength: 1,
                },
                error: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
          },
          tokenUsage: {
            type: "object",
            additionalProperties: false,
            required: ["perStage", "total"],
            properties: {
              perStage: {
                type: "object",
                properties: {},
                additionalProperties: true,
              },
              total: {
                type: "number",
                minimum: 0,
              },
            },
          },
          artifactPath: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
    artifactPaths: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
      },
    },
    tokenUsage: {
      type: "object",
      additionalProperties: false,
      required: ["perStage", "total"],
      properties: {
        perStage: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
        total: {
          type: "number",
          minimum: 0,
        },
      },
    },
    correlationId: {
      type: "string",
      minLength: 1,
    },
  },
} as const;
