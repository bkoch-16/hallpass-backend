import rateLimit, { ipKeyGenerator, Store } from "express-rate-limit";
import { Request } from "express";
import { createRedisRateLimitStore } from "@hallpass/express-middleware";
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
  const isTest = process.env.NODE_ENV === "test";
  const defaultLimit = isTest ? Number.MAX_SAFE_INTEGER : 60;

  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    limit: options.limit ?? defaultLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
    store: options.store ?? createRedisRateLimitStore(redis, KEY_PREFIX),
    // Default (passOnStoreError: false) already fails closed — a store error
    // throws and propagates to the app's error handler as a 500, rather than
    // silently letting unlimited traffic through this now-public endpoint.
  });
}
