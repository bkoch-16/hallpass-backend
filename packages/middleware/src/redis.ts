import Redis from "ioredis";
import { logger } from "@hallpass/logger";

/**
 * Rate-limit store client. Returns null when REDIS_URL is unset (local
 * `pnpm dev`, tests), in which case limiters fall back to express-rate-limit's
 * in-memory store. Used by user-api and schools-api (optional Redis); passes-api
 * has its own required-Redis client for slots/queue.
 */
export function createRateLimitRedis(env: { REDIS_URL?: string }): Redis | null {
  if (!env.REDIS_URL) return null;
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  redis.on("error", (err) => {
    logger.error(err, "[redis] connection error");
  });
  return redis;
}
