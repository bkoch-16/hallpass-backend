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
 * Optional Redis rate-limit env fields shared by user-api and schools-api.
 * REDIS_URL is optional: when set the limiters use a shared-Redis store; when
 * unset they fall back to express-rate-limit's in-memory store. REDIS_PREFIX
 * namespaces keys on the shared Upstash DB and is required only alongside a URL.
 * Passes-api does NOT use this (its Redis is required, not optional).
 */
export const optionalRedisEnvShape = {
  REDIS_URL: z.string().url().optional(),
  REDIS_PREFIX: z.string().min(1).optional(),
} as const;

/** Refine that enforces REDIS_PREFIX when REDIS_URL is present. Apply after .extend(optionalRedisEnvShape). */
export function requireRedisPrefixWithUrl<T extends { REDIS_URL?: string; REDIS_PREFIX?: string }>(
  d: T,
): boolean {
  return !d.REDIS_URL || Boolean(d.REDIS_PREFIX);
}
export const REDIS_PREFIX_REFINE_MESSAGE = "REDIS_PREFIX is required when REDIS_URL is set";
