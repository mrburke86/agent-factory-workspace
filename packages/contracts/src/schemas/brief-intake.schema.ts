import { z } from "zod";
import { TechStackSchema } from "./layer2-config.schema.js";

const NON_EMPTY = z.string().min(1);

export const ClarificationCategorySchema = z.enum(["security", "architecture", "features", "ux"]);
export type ClarificationCategory = z.infer<typeof ClarificationCategorySchema>;

export const ClarificationImpactSchema = z.enum(["high", "medium", "low"]);
export type ClarificationImpact = z.infer<typeof ClarificationImpactSchema>;

/**
 * Consumed by:
 * - services/agents/brief-intake
 * - packages/evals/scripts/eval_brief_intake.ts
 */
export const StructuredBriefSchema = z.object({
  projectName: NON_EMPTY,
  techStack: TechStackSchema,
  features: z.array(NON_EMPTY),
  constraints: z.array(NON_EMPTY),
  userStories: z.array(NON_EMPTY),
});

export type StructuredBrief = z.infer<typeof StructuredBriefSchema>;

/**
 * Consumed by:
 * - services/agents/brief-intake
 * - packages/evals/scripts/eval_brief_intake.ts
 */
export const ClarificationRequestSchema = z.object({
  id: NON_EMPTY,
  question: NON_EMPTY,
  category: ClarificationCategorySchema,
  impact: ClarificationImpactSchema,
  defaultAssumption: NON_EMPTY,
});

export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;

export const ScopeEstimateSchema = z.object({
  sprintCountRange: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .refine(([min, max]) => min <= max, {
      message: "sprintCountRange must be ordered",
    }),
  complexityRating: z.enum(["low", "medium", "high"]),
});

export type ScopeEstimate = z.infer<typeof ScopeEstimateSchema>;

/**
 * Consumed by:
 * - services/agents/brief-intake
 */
export const BriefIntakeInputSchema = z.object({
  brief: NON_EMPTY,
  userPreferences: z.record(z.unknown()).optional(),
});

export type BriefIntakeInput = z.infer<typeof BriefIntakeInputSchema>;

/**
 * Consumed by:
 * - services/agents/brief-intake
 */
export const BriefIntakeOutputSchema = z.object({
  structuredBrief: StructuredBriefSchema,
  clarifyingQuestions: z.array(ClarificationRequestSchema).max(5),
  resolvedAssumptions: z.array(NON_EMPTY),
  scopeEstimate: ScopeEstimateSchema,
});

export type BriefIntakeOutput = z.infer<typeof BriefIntakeOutputSchema>;

export const BRIEF_INTAKE_INPUT_SCHEMA_JSON_PATH = "packages/contracts/dist/schemas/brief-intake.input.schema.json";
export const BRIEF_INTAKE_OUTPUT_SCHEMA_JSON_PATH = "packages/contracts/dist/schemas/brief-intake.output.schema.json";

export const briefIntakeInputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/brief-intake.input.schema.json",
  title: "BriefIntakeInput",
  type: "object",
  additionalProperties: false,
  required: ["brief"],
  properties: {
    brief: {
      type: "string",
      minLength: 1,
    },
    userPreferences: {
      type: "object",
      additionalProperties: true,
    },
  },
} as const;

export const briefIntakeOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/brief-intake.output.schema.json",
  title: "BriefIntakeOutput",
  type: "object",
  additionalProperties: false,
  required: ["structuredBrief", "clarifyingQuestions", "resolvedAssumptions", "scopeEstimate"],
  properties: {
    structuredBrief: {
      type: "object",
      additionalProperties: false,
      required: ["projectName", "techStack", "features", "constraints", "userStories"],
      properties: {
        projectName: { type: "string", minLength: 1 },
        techStack: {
          type: "object",
          additionalProperties: false,
          required: ["language", "framework"],
          properties: {
            language: { type: "string", minLength: 1 },
            framework: { type: "string", minLength: 1 },
            database: { type: "string", minLength: 1 },
            auth: { type: "string", minLength: 1 },
            payments: { type: "string", minLength: 1 },
          },
        },
        features: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        constraints: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        userStories: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
      },
    },
    clarifyingQuestions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "category", "impact", "defaultAssumption"],
        properties: {
          id: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
          category: {
            type: "string",
            enum: ["security", "architecture", "features", "ux"],
          },
          impact: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          defaultAssumption: { type: "string", minLength: 1 },
        },
      },
    },
    resolvedAssumptions: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    scopeEstimate: {
      type: "object",
      additionalProperties: false,
      required: ["sprintCountRange", "complexityRating"],
      properties: {
        sprintCountRange: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "integer", minimum: 0 },
        },
        complexityRating: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
      },
    },
  },
} as const;
