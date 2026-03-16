import { z } from "zod";

export const createPassBody = z.object({
  destinationId: z.number().int().positive(),
  note: z.string().optional(),
});

export const approvePassBody = z.object({
  approverNote: z.string().optional(),
});

export const denyPassBody = z.object({
  approverNote: z.string().optional(),
});

export const cancelPassBody = z.object({});

export const passIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const listPassesQuery = z.object({
  status: z.enum(["PENDING", "WAITING", "ACTIVE", "COMPLETED", "CANCELLED", "DENIED", "EXPIRED"]).optional(),
});
