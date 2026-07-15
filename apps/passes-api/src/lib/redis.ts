import Redis from "ioredis";
import { createRequiredRedis } from "@hallpass/express-middleware";
import { env } from "../env.js";

export const redis = createRequiredRedis(env.REDIS_URL);

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
