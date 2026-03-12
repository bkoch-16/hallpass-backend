import { z } from "zod";
import { PolicyInterval } from "@hallpass/types";

export const upsertPolicySchema = z
  .object({
    maxActivePasses: z.number().int().positive().nullable().optional(),
    interval: z.enum([PolicyInterval.DAY, PolicyInterval.WEEK, PolicyInterval.MONTH]).nullable().optional(),
    maxPerInterval: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (data) => {
      const hasInterval = data.interval != null;
      const hasMax = data.maxPerInterval != null;
      return hasInterval === hasMax;
    },
    { message: "interval and maxPerInterval must be set together or both omitted" },
  );
