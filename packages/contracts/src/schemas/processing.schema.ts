import { z } from "zod";

export const ProcessingStatusSchema = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  updatedAt: z.string(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional()
});
