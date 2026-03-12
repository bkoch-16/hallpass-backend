import { z } from "zod";

export const scheduleTypeIdSchema = z.object({
  schoolId: z.string().regex(/^\d+$/, "schoolId must be a positive integer"),
  id: z.string().min(1, "id is required"),
});

export const createScheduleTypeSchema = z.object({
  name: z.string().min(1, "name is required"),
  startBuffer: z.number().int().min(0).optional(),
  endBuffer: z.number().int().min(0).optional(),
});

export const updateScheduleTypeSchema = z
  .object({
    name: z.string().min(1).optional(),
    startBuffer: z.number().int().min(0).optional(),
    endBuffer: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
