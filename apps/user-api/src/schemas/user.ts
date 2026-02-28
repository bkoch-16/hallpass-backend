import { z } from "zod";

export const batchQuerySchema = z.object({
  ids: z.string().min(1, "ids is required"),
});

export const userIdSchema = z.object({
  id: z.string().min(1, "id is required"),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email("Invalid email").optional(),
  role: z.enum(["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"]).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "At least one field is required",
});

export const createUserSchema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(1, "name is required"),
  role: z.enum(["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"]).optional(),
});
