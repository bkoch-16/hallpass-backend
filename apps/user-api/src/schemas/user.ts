import { z } from "zod";

export const batchQuerySchema = z.object({
    ids: z.string().min(1, "ids is required"),
});

export const userIdSchema = z.object({
    id: z.string().cuid("invalid user id"),
});