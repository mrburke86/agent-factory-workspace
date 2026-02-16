import { z } from "zod";

export const EventEnvelopeSchema = z.object({
  eventName: z.string(),
  eventVersion: z.string(),
  occurredAt: z.string(), // ISO timestamp
  correlationId: z.string(),
  tenantId: z.string().optional(),
  payload: z.unknown()
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
