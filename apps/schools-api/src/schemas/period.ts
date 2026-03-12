import { z } from "zod";

const timeString = z.string().regex(/^\d{2}:\d{2}$/, "must be HH:MM format");

export const periodIdSchema = z.object({
  schoolId: z.string().regex(/^\d+$/, "schoolId must be a positive integer"),
  scheduleTypeId: z.string().min(1, "scheduleTypeId is required"),
  id: z.string().min(1, "id is required"),
});

export const createPeriodSchema = z.object({
  name: z.string().min(1, "name is required"),
  startTime: timeString,
  endTime: timeString,
  order: z.number().int().min(0),
});

export const updatePeriodSchema = z
  .object({
    name: z.string().min(1).optional(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
