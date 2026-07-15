import Redis from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { logger } from "@hallpass/logger";

export function createRequiredRedis(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  redis.on("error", (err) => {
    logger.error(err, "[redis] connection error");
  });
  return redis;
}

/**
 * Rate-limit store client. Returns null when REDIS_URL is unset (local
 * `pnpm dev`, tests), in which case limiters fall back to express-rate-limit's
 * in-memory store. Used by user-api only now (optional Redis); passes-api has
 * its own required-Redis client for slots/queue, and schools-api has its own
 * required-Redis client (apps/schools-api/src/lib/redis.ts).
 */
export function createRateLimitRedis(env: { REDIS_URL?: string }): Redis | null {
  if (!env.REDIS_URL) return null;
  return createRequiredRedis(env.REDIS_URL);
}

/**
 * rate-limit-redis Store over an ioredis client. Each limiter needs its own
 * instance (rate-limit-redis stores can't be shared between limiters).
 */
export function createRedisRateLimitStore(redis: Redis, prefix: string): RedisStore {
  const store = new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });
  // RedisStore's constructor fires unawaited SCRIPT LOAD commands and stores the
  // pending promises on incrementScriptSha/getScriptSha. If a limiter is built at
  // module load (before any request awaits those promises via retryableIncrement)
  // and the initial Redis command fails, Node reports an unhandled rejection with
  // nothing listening yet, which our process-level handler treats as fatal. These
  // no-op catches only suppress that early "unhandled" report; retryableIncrement
  // still awaits the same promises per-request, so a genuine outage still fails
  // closed with a 500 as intended.
  store.incrementScriptSha.catch(() => {});
  store.getScriptSha.catch(() => {});
  return store;
}
