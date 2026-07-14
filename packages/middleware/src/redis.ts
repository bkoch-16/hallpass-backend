import Redis from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";
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

/**
 * rate-limit-redis Store over an ioredis client. Each limiter needs its own
 * instance (rate-limit-redis stores can't be shared between limiters).
 */
export function createRedisRateLimitStore(redis: Redis, prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });
}
