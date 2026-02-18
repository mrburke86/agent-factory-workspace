import { z } from "zod";

const RepoPathSchema = z.string().min(1);

export const RepoPatchModeSchema = z.enum(["dry-run", "apply", "validate", "pr-ready"]);

export const RepoPatchTaskSchema = z.object({
  taskId: z.string().min(1),
  goal: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  fileScope: z.array(RepoPathSchema).min(1),
  mode: RepoPatchModeSchema
});

export type RepoPatchTask = z.infer<typeof RepoPatchTaskSchema>;

export const RepoPatchPlanSchema = z.object({
  steps: z.array(z.string().min(1)),
  touchedFiles: z.array(RepoPathSchema),
  commands: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1))
});

export type RepoPatchPlan = z.infer<typeof RepoPatchPlanSchema>;

export const RepoPatchPatchItemSchema = z.object({
  path: RepoPathSchema,
  unifiedDiff: z.string().min(1),
  rationale: z.string().min(1)
});

export type RepoPatchPatchItem = z.infer<typeof RepoPatchPatchItemSchema>;

export const RepoPatchPatchSchema = z.array(RepoPatchPatchItemSchema);

export type RepoPatchPatch = z.infer<typeof RepoPatchPatchSchema>;

export const RepoPatchResultTimingSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().nonnegative()
});

export const RepoPatchResultOutputSchema = z.object({
  key: z.string().min(1),
  value: z.unknown()
});

export const RepoPatchResultErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});

export const RepoPatchResultSchema = z.object({
  ok: z.boolean(),
  correlationId: z.string().min(1),
  timings: RepoPatchResultTimingSchema,
  outputs: z.array(RepoPatchResultOutputSchema),
  errors: z.array(RepoPatchResultErrorSchema)
});

export type RepoPatchResult = z.infer<typeof RepoPatchResultSchema>;
