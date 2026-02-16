import { z } from "zod";

export const ProcessingJobStartedV1 = z.object({
  jobId: z.string(),
  fileId: z.string(),
  pipeline: z.enum(["ocr", "extract", "embed", "index"]),
  startedAt: z.string() // ISO timestamp
});

export type ProcessingJobStartedV1 = z.infer<typeof ProcessingJobStartedV1>;
