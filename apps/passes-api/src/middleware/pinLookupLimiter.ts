import { createIpRateLimiter } from "@hallpass/express-middleware";
import type { Store } from "express-rate-limit";
import { redis } from "../lib/redis.js";
import { env } from "../env.js";

const KEY_PREFIX = `${env.REDIS_PREFIX}:rl:passes-api:parent-lookup:`;

export interface PinLookupLimiterOptions {
  limit?: number;
  windowMs?: number;
  store?: Store;
}

export function createPinLookupLimiter(options: PinLookupLimiterOptions = {}) {
  return createIpRateLimiter({
    redis,
    keyPrefix: KEY_PREFIX,
    windowMs: options.windowMs,
    limit: options.limit,
    defaultLimit: 10,
    skipSuccessfulRequests: true,
    store: options.store,
  });
}
