import { z } from "zod";

export const districtIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

export const listDistrictsSchema = z.object({
  cursor: z.string().regex(/^[1-9]\d*$/, "cursor must be a positive integer").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createDistrictSchema = z.object({
  name: z.string().min(1, "name is required"),
});

export const updateDistrictSchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
