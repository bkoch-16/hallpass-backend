import Redis from "ioredis";
import { logger } from "@hallpass/logger";
import { env } from "../env.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  logger.error(err, "[redis] connection error");
});

/**
 * Creates a Redis connection for blocking consumers (the socket.io adapter's
 * pub client), which require `maxRetriesPerRequest: null` so blocking commands
 * are never cut short. `lazyConnect` defers connection so callers can attach a
 * catch to the initial connect and degrade gracefully instead of crashing on
 * an unhandled rejection.
 */
export function createBlockingRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
}
