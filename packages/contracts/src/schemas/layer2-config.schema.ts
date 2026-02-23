import { z } from "zod";

const NON_EMPTY = z.string().min(1);
const PLACEHOLDER_REGEX = /\{\{[^{}]+\}\}/;

export const StageOverrideSchema = z.object({
  promptTemplate: NON_EMPTY.regex(PLACEHOLDER_REGEX),
  constraints: z.array(NON_EMPTY).min(1),
  expectedOutputs: z.array(NON_EMPTY).min(1),
  acceptanceCriteria: z.array(NON_EMPTY).min(1),
});

export type StageOverride = z.infer<typeof StageOverrideSchema>;

export const TechStackSchema = z.object({
  language: NON_EMPTY,
  framework: NON_EMPTY,
  database: NON_EMPTY.optional(),
  auth: NON_EMPTY.optional(),
  payments: NON_EMPTY.optional(),
});

export type TechStack = z.infer<typeof TechStackSchema>;

export const Layer2StagesSchema = z
  .object({
    plan: StageOverrideSchema,
    implement: StageOverrideSchema,
  })
  .catchall(StageOverrideSchema);

export const Layer2ConfigSchema = z.object({
  projectName: NON_EMPTY,
  techStack: TechStackSchema,
  stages: Layer2StagesSchema,
});

export type Layer2Config = z.infer<typeof Layer2ConfigSchema>;

export const LAYER2_CONFIG_SCHEMA_JSON_PATH = "packages/contracts/dist/schemas/layer2-config.schema.json";

export const layer2ConfigJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://acme.local/schemas/layer2-config.schema.json",
  title: "Layer2Config",
  type: "object",
  additionalProperties: false,
  required: ["projectName", "techStack", "stages"],
  properties: {
    projectName: {
      type: "string",
      minLength: 1,
    },
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
    stages: {
      type: "object",
      minProperties: 2,
      required: ["plan", "implement"],
      properties: {
        plan: { $ref: "#/definitions/stageOverride" },
        implement: { $ref: "#/definitions/stageOverride" },
      },
      additionalProperties: { $ref: "#/definitions/stageOverride" },
    },
  },
  definitions: {
    stageOverride: {
      type: "object",
      additionalProperties: false,
      required: ["promptTemplate", "constraints", "expectedOutputs", "acceptanceCriteria"],
      properties: {
        promptTemplate: {
          type: "string",
          minLength: 1,
          pattern: "\\{\\{[^{}]+\\}\\}",
        },
        constraints: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        expectedOutputs: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        acceptanceCriteria: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;
