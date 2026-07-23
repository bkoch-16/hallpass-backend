import { z } from "zod";
import { dateString } from "@hallpass/types";

export const calendarIdSchema = z.object({
  schoolId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive(),
});

export const calendarQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

// calendarEntrySchema/calendarBulkSchema live in @hallpass/types so
// CalendarEntryBody can't drift from what's actually enforced — see
// packages/types/src/schemas.ts.
export { calendarEntrySchema, calendarBulkSchema } from "@hallpass/types";

export const updateCalendarSchema = z
  .object({
    scheduleTypeId: z.number().int().positive().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
