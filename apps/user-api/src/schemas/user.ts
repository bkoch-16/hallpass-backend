import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@hallpass/types";

export const userIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

export const listUsersSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  cursor: z.string().regex(/^[1-9]\d*$/, "cursor must be a positive integer").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  ids: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

// createUserSchema/updateUserSchema/bulkCreateSchema live in @hallpass/types
// so CreateUserBody/UpdateUserBody can't drift from what's actually enforced
// — see packages/types/src/schemas.ts.
export { createUserSchema, updateUserSchema, bulkCreateSchema } from "@hallpass/types";
