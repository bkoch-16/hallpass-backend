import { z } from "zod";

export const schoolIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

export const schoolParamSchema = z.object({
  schoolId: z.string().regex(/^\d+$/, "schoolId must be a positive integer"),
});

export const listSchoolsSchema = z.object({
  cursor: z.preprocess(v => v === "" ? undefined : v, z.string().regex(/^[1-9]\d*$/, "cursor must be a positive integer").optional()),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createSchoolSchema = z.object({
  name: z.string().min(1, "name is required"),
  timezone: z.string().optional(),
  districtId: z.number().int().positive().optional(),
});

export const updateSchoolSchema = z
  .object({
    name: z.string().min(1).optional(),
    timezone: z.string().optional(),
    districtId: z.number().int().positive().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
