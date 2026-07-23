import { z } from "zod";
import { ASSIGNABLE_ROLES } from "./enums.js";

// ─── School ───────────────────────────────────────────────────────────────────

const IANA_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export const timezoneSchema = z
  .string()
  .refine((tz) => IANA_TIMEZONES.has(tz), {
    message: "timezone must be a valid IANA time zone",
  })
  .optional();

export const createSchoolSchema = z.object({
  name: z.string().min(1, "name is required"),
  timezone: timezoneSchema,
  districtId: z.number().int().positive().optional(),
});

export const updateSchoolSchema = z
  .object({
    name: z.string().min(1).optional(),
    timezone: timezoneSchema,
    districtId: z.number().int().positive().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type CreateSchoolBody = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolBody = z.infer<typeof updateSchoolSchema>;

// ─── School calendar ────────────────────────────────────────────────────────

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format")
  .refine(
    (value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: "must be a valid calendar date" },
  );

export const calendarEntrySchema = z.object({
  date: dateString,
  scheduleTypeId: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const calendarBulkSchema = z.union([
  calendarEntrySchema,
  z.array(calendarEntrySchema).min(1).max(366),
]);

export type CalendarEntryBody = z.infer<typeof calendarEntrySchema>;

// ─── Users ──────────────────────────────────────────────────────────────────

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

export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
