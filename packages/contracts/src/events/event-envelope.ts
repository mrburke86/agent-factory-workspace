import { z } from "zod";

/**
 * Consumed by:
 * - services/agents/code-gen
 */
export const EventEnvelopeSchema = z.object({
  eventName: z.string(),
  eventVersion: z.string(),
  occurredAt: z.string(), // ISO timestamp
  correlationId: z.string(),
  tenantId: z.string().optional(),
  payload: z.unknown()
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
