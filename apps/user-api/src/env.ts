import {
  baseEnvSchema,
  optionalRedisEnvShape,
  requireRedisPrefixWithUrl,
  REDIS_PREFIX_REFINE_MESSAGE,
} from "@hallpass/express-middleware";

// REDIS_URL is optional: when set (Cloud Run, or docker-compose locally) the rate
// limiters use a shared-Redis store; when unset (plain `pnpm dev`, tests) they fall
// back to express-rate-limit's in-memory store. REDIS_PREFIX namespaces keys on the
// shared Upstash DB and is required only alongside a URL.
const envSchema = baseEnvSchema
  .extend(optionalRedisEnvShape)
  .refine(requireRedisPrefixWithUrl, { message: REDIS_PREFIX_REFINE_MESSAGE });

export const env = envSchema.parse(process.env);
