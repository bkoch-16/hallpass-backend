import { z } from "zod";

export const destinationIdSchema = z.object({
  schoolId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive(),
});

export const createDestinationSchema = z.object({
  name: z.string().min(1, "name is required"),
  maxOccupancy: z.number().int().positive().nullable().optional(),
});

export const updateDestinationSchema = z
  .object({
    name: z.string().min(1).optional(),
    maxOccupancy: z.number().int().positive().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
