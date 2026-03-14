import { z } from "zod";

export const TenantScopedSchema = z.object({
  tenantId: z.string()
});

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
});

const NON_EMPTY = z.string().min(1);

/**
 * Consumed by:
 * - services/agents/auth-scaffold
 * - services/agents/payments-gen
 */
export const DecisionLevelSchema = z.enum(["full_autonomy", "supervised", "human_required"]);

export type DecisionLevel = z.infer<typeof DecisionLevelSchema>;

/**
 * Consumed by:
 * - services/agents/auth-scaffold
 * - services/agents/payments-gen
 */
export const DecisionLogEntrySchema = z.object({
  key: NON_EMPTY,
  level: DecisionLevelSchema,
  summary: NON_EMPTY,
  rationale: NON_EMPTY,
  selectedOption: NON_EMPTY,
  alternatives: z.array(NON_EMPTY).min(1).optional(),
});

export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>;

export const KNOWN_TASK_CLASSIFICATIONS = [
  "scaffold",
  "schema_gen",
  "route_gen",
  "component_gen",
  "auth_config",
  "payment_config",
] as const;

export const KnownTaskClassificationSchema = z.enum(KNOWN_TASK_CLASSIFICATIONS);

export type KnownTaskClassification = z.infer<typeof KnownTaskClassificationSchema>;
export type TaskClassification = KnownTaskClassification | (string & {});

/**
 * Consumed by:
 * - services/agents/orchestrator
 * - packages/evals/scripts/eval_golden_fixtures.ts
 * - packages/evals/scripts/eval_phase4_integration.ts
 */
export const TaskClassificationSchema = z.union([KnownTaskClassificationSchema, NON_EMPTY]);
