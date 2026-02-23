import { z } from "zod";

export const RankedFileSchema = z.object({
  path: z.string().min(1),
  relevanceScore: z.number().min(0).max(1),
  summary: z.string().min(1),
});

export type RankedFile = z.infer<typeof RankedFileSchema>;

export const ContextGatherInputSchema = z.object({
  repoRoot: z.string().min(1),
  taskDescription: z.string().min(1),
  maxFiles: z.number().int().min(1).max(200).optional(),
});

export type ContextGatherInput = z.infer<typeof ContextGatherInputSchema>;

export const ContextGatherOutputSchema = z.object({
  files: z.array(RankedFileSchema),
  tokenEstimate: z.number().int().nonnegative(),
});

export type ContextGatherOutput = z.infer<typeof ContextGatherOutputSchema>;
