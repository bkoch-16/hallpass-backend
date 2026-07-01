import { z } from "zod";
import { PassStatus } from "@hallpass/db";

export const createPassBody = z.object({
  destinationId: z.number().int().positive(),
  note: z.string().optional(),
});

export const approvePassBody = z.object({
  approverNote: z.string().optional(),
});

export const denyPassBody = approvePassBody;

export const passIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const listPassesQuery = z.object({
  status: z.nativeEnum(PassStatus).optional(),
});
