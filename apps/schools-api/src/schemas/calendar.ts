import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format");

export const calendarIdSchema = z.object({
  schoolId: z.string().regex(/^\d+$/, "schoolId must be a positive integer"),
  id: z.string().min(1, "id is required"),
});

export const calendarQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

export const calendarEntrySchema = z.object({
  date: dateString,
  scheduleTypeId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const calendarBulkSchema = z.union([
  calendarEntrySchema,
  z.array(calendarEntrySchema).min(1),
]);

export const updateCalendarSchema = z
  .object({
    scheduleTypeId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
