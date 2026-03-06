import { z } from "zod";
import { EventEnvelopeSchema } from "../events/event-envelope.js";
import { RecoveryActionSchema } from "./error-recover.schema.js";

const NON_EMPTY = z.string().min(1);

export const FileSpecTechStackSchema = z.object({
  language: NON_EMPTY,
  framework: NON_EMPTY,
});

export type FileSpecTechStack = z.infer<typeof FileSpecTechStackSchema>;

/**
 * Consumed by:
 * - services/agents/code-gen
 * - services/agents/project-scaffold
 */
export const FileSpecSchema = z.object({
  path: NON_EMPTY,
  purpose: NON_EMPTY,
  techStack: FileSpecTechStackSchema,
  templateHints: z.array(NON_EMPTY).optional(),
  dependencies: z.array(NON_EMPTY).optional(),
});

export type FileSpec = z.infer<typeof FileSpecSchema>;

/**
 * Consumed by:
 * - services/agents/code-gen
 * - services/agents/project-scaffold
 */
export const GeneratedFileSchema = z.object({
  path: NON_EMPTY,
  content: z.string(),
  language: NON_EMPTY,
});

export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

/**
 * Consumed by:
 * - services/agents/code-gen
 * - packages/evals/fixtures/code-gen/*.json
 */
export const CodeGenInputSchema = z
  .object({
    fileSpec: FileSpecSchema.optional(),
    fileSpecs: z.array(FileSpecSchema).min(1).optional(),
    outputDir: NON_EMPTY.optional(),
    correlationId: NON_EMPTY.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.fileSpec && (!value.fileSpecs || value.fileSpecs.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one of fileSpec or fileSpecs is required",
      });
    }
  });

export type CodeGenInput = z.infer<typeof CodeGenInputSchema>;

export const CodeGenRecoverySchema = z.object({
  action: RecoveryActionSchema,
  rationale: NON_EMPTY,
});

export type CodeGenRecovery = z.infer<typeof CodeGenRecoverySchema>;

/**
 * Consumed by:
 * - services/agents/code-gen
 */
export const CodeGenOutputSchema = z.object({
  generatedFiles: z.array(GeneratedFileSchema),
  runtimeEvents: z.array(EventEnvelopeSchema),
  recovery: CodeGenRecoverySchema.optional(),
});

export type CodeGenOutput = z.infer<typeof CodeGenOutputSchema>;

export const codeGenInputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/code-gen.input.schema.json",
  title: "CodeGenInput",
  type: "object",
  additionalProperties: false,
  anyOf: [{ required: ["fileSpec"] }, { required: ["fileSpecs"] }],
  properties: {
    fileSpec: {
      type: "object",
      additionalProperties: false,
      required: ["path", "purpose", "techStack"],
      properties: {
        path: { type: "string", minLength: 1 },
        purpose: { type: "string", minLength: 1 },
        techStack: {
          type: "object",
          additionalProperties: false,
          required: ["language", "framework"],
          properties: {
            language: { type: "string", minLength: 1 },
            framework: { type: "string", minLength: 1 },
          },
        },
        templateHints: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        dependencies: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
      },
    },
    fileSpecs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "purpose", "techStack"],
        properties: {
          path: { type: "string", minLength: 1 },
          purpose: { type: "string", minLength: 1 },
          techStack: {
            type: "object",
            additionalProperties: false,
            required: ["language", "framework"],
            properties: {
              language: { type: "string", minLength: 1 },
              framework: { type: "string", minLength: 1 },
            },
          },
          templateHints: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          dependencies: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    outputDir: { type: "string", minLength: 1 },
    correlationId: { type: "string", minLength: 1 },
  },
} as const;

export const codeGenOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/code-gen.output.schema.json",
  title: "CodeGenOutput",
  type: "object",
  additionalProperties: false,
  required: ["generatedFiles", "runtimeEvents"],
  properties: {
    generatedFiles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "language"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
          language: { type: "string", minLength: 1 },
        },
      },
    },
    runtimeEvents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["eventName", "eventVersion", "occurredAt", "correlationId", "payload"],
        properties: {
          eventName: { type: "string" },
          eventVersion: { type: "string" },
          occurredAt: { type: "string" },
          correlationId: { type: "string" },
          tenantId: { type: "string" },
          payload: {},
        },
      },
    },
    recovery: {
      type: "object",
      additionalProperties: false,
      required: ["action", "rationale"],
      properties: {
        action: {
          type: "string",
          enum: ["retry_modified", "rollback", "skip_and_flag", "escalate"],
        },
        rationale: { type: "string", minLength: 1 },
      },
    },
  },
} as const;
