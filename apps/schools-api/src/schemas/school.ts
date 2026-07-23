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

// createSchoolSchema/updateSchoolSchema live in @hallpass/types so the
// request-body types exported for a frontend can't drift from what's
// actually enforced here — see packages/types/src/schemas.ts.
export { createSchoolSchema, updateSchoolSchema } from "@hallpass/types";
