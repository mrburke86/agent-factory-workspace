import { z } from "zod";

export const IngestionFileReceivedV1 = z.object({
  fileId: z.string(),
  source: z.enum(["upload", "email", "import"]),
  originalFilename: z.string().optional(),
  mimeType: z.string().optional(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative()
});

export type IngestionFileReceivedV1 = z.infer<typeof IngestionFileReceivedV1>;
