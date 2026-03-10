import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@hallpass/types";

export const userIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

export const listUsersSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  cursor: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  ids: z.string().optional(),
});

export const createUserSchema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(1, "name is required"),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
});

export const bulkCreateSchema = z.array(createUserSchema).min(1).max(100);

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email("Invalid email").optional(),
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    schoolId: z.number().int().positive().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
