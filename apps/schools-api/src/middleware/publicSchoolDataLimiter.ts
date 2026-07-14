import { createIpRateLimiter } from "@hallpass/express-middleware";
import type { Store } from "express-rate-limit";
import { redis } from "../lib/redis.js";
import { env } from "../env.js";

const KEY_PREFIX = `${env.REDIS_PREFIX}:rl:schools-api:public-school-data:`;

export interface PublicSchoolDataLimiterOptions {
  limit?: number;
  windowMs?: number;
  store?: Store;
}

export function createPublicSchoolDataLimiter(
  options: PublicSchoolDataLimiterOptions = {},
) {
  return createIpRateLimiter({
    redis,
    keyPrefix: KEY_PREFIX,
    windowMs: options.windowMs,
    limit: options.limit,
    defaultLimit: 60,
    store: options.store,
  });
}
