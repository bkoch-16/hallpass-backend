import { z } from "zod";

/**
 * Env fields common to all three APIs. PORT is coerced to a number and has
 * NO default — port defaults stay app-specific. App-only fields (e.g.
 * passes-api's REDIS_URL/REDIS_PREFIX/INTERNAL_SECRET) are added via
 * .extend().
 */
export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  PORT: z.coerce.number().optional(),
  CORS_ORIGIN: z.string().min(1),
});
