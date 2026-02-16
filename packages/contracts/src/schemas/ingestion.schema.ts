import { z } from "zod";

export const IngestionMetadataSchema = z.object({
  source: z.enum(["upload", "email", "import"]),
  receivedAt: z.string(),
  originalFilename: z.string().optional(),
  mimeType: z.string().optional()
});
