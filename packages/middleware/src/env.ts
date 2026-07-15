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

/**
 * Optional Redis rate-limit env fields, currently used only by user-api
 * (via rateLimitEnvSchema below). REDIS_URL is optional: when set the
 * limiters use a shared-Redis store; when unset they fall back to
 * express-rate-limit's in-memory store. REDIS_PREFIX namespaces keys on the
 * shared Upstash DB and is required only alongside a URL.
 * Passes-api and schools-api do NOT use this — passes-api's Redis is
 * required (not optional), and schools-api has its own required-Redis
 * schema in apps/schools-api/src/env.ts.
 */
const optionalRedisEnvShape = {
  REDIS_URL: z.string().url().optional(),
  REDIS_PREFIX: z.string().min(1).optional(),
} as const;

/** Refine that enforces REDIS_PREFIX when REDIS_URL is present. Apply after .extend(optionalRedisEnvShape). */
function requireRedisPrefixWithUrl<T extends { REDIS_URL?: string; REDIS_PREFIX?: string }>(
  d: T,
): boolean {
  return !d.REDIS_URL || Boolean(d.REDIS_PREFIX);
}
const REDIS_PREFIX_REFINE_MESSAGE = "REDIS_PREFIX is required when REDIS_URL is set";

/**
 * Env schema for apps with optional Redis rate limiting. Currently used
 * only by user-api. REDIS_URL is optional: when set (Cloud Run, or
 * docker-compose locally) the rate limiters use a shared-Redis store; when
 * unset (plain `pnpm dev`, tests) they fall back to express-rate-limit's
 * in-memory store. REDIS_PREFIX namespaces keys on the shared Upstash DB
 * and is required only alongside a URL. schools-api now uses its own
 * required-Redis schema (apps/schools-api/src/env.ts) instead of this one.
 */
export const rateLimitEnvSchema = baseEnvSchema
  .extend(optionalRedisEnvShape)
  .refine(requireRedisPrefixWithUrl, { message: REDIS_PREFIX_REFINE_MESSAGE });
