import { z } from "zod";
import { PassStatus } from "@hallpass/db";

export const createPassBody = z.object({
  // Ignored for STUDENT callers; required for TEACHER+ (enforced in the route)
  studentId: z.number().int().positive().optional(),
  destinationId: z.number().int().positive(),
  note: z.string().optional(),
});

export const approvePassBody = z.object({
  approverNote: z.string().optional(),
});

export const denyPassBody = z.object({
  denierNote: z.string().optional(),
});

export const passIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const cursorPaginationFields = {
  cursor: z.preprocess(v => v === "" ? undefined : v, z.string().regex(/^[1-9]\d*$/, "cursor must be a positive integer").optional()),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

// Comma-separated list of PassStatus values — a single value (no comma) stays valid.
const passStatusList = z
  .string()
  .transform((val) => val.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
  .pipe(z.array(z.nativeEnum(PassStatus)).min(1));

export const listPassesQuery = z
  .object({
    status: passStatusList.optional(),
    studentId: z.coerce.number().int().positive().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    ...cursorPaginationFields,
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: "from must not be after to",
    path: ["from"],
  });

// Deliberately loose — NO format regex. A wrong-format PIN must be
// indistinguishable from a non-matching one (no enumeration signal).
export const parentLookupQuery = z.object({
  pin: z.string().trim().min(1).max(64),
  ...cursorPaginationFields,
});
