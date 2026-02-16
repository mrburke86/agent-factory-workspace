import { z } from "zod";
import type { ErrorCode } from "./error-codes.js";

export const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  details: z.record(z.any()).optional()
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema> & {
  code: ErrorCode | string; // allow extension without immediate break
};
