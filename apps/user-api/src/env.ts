import { z } from "zod";
import { baseEnvSchema } from "@hallpass/express-middleware";

// REDIS_URL is optional: when set (Cloud Run, or docker-compose locally) the rate
// limiters use a shared-Redis store; when unset (plain `pnpm dev`, tests) they fall
// back to express-rate-limit's in-memory store. REDIS_PREFIX namespaces keys on the
// shared Upstash DB and is required only alongside a URL.
const envSchema = baseEnvSchema
  .extend({
    REDIS_URL: z.string().url().optional(),
    REDIS_PREFIX: z.string().min(1).optional(),
  })
  .refine((d) => !d.REDIS_URL || d.REDIS_PREFIX, {
    message: "REDIS_PREFIX is required when REDIS_URL is set",
  });

export const env = envSchema.parse(process.env);
