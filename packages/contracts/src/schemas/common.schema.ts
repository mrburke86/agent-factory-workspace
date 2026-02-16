import { z } from "zod";

export const TenantScopedSchema = z.object({
  tenantId: z.string()
});

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
});
