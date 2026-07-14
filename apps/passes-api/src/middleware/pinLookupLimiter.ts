import rateLimit, { ipKeyGenerator, Store, ClientRateLimitInfo } from "express-rate-limit";
import { Request } from "express";
import { redis } from "../lib/redis.js";
import { env } from "../env.js";

const KEY_PREFIX = `${env.REDIS_PREFIX}:rl:passes-api:parent-lookup:`;

// Minimal ioredis-backed Store: INCR + PEXPIRE-on-first-increment. Shared
// across instances so the brake on PIN-guessing is meaningful across
// multiple server processes (unlike the default in-memory store).
class RedisStore implements Store {
  windowMs = 15 * 60 * 1000;

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const totalHits = await redis.incr(redisKey);
    if (totalHits === 1) {
      await redis.pexpire(redisKey, this.windowMs);
    }
    const ttl = await redis.pttl(redisKey);
    const resetTime =
      ttl >= 0 ? new Date(Date.now() + ttl) : new Date(Date.now() + this.windowMs);
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const current = await redis.decr(redisKey);
    if (current <= 0) {
      await redis.del(redisKey);
    }
  }

  async resetKey(key: string): Promise<void> {
    await redis.del(`${KEY_PREFIX}${key}`);
  }
}

export interface PinLookupLimiterOptions {
  limit?: number;
  windowMs?: number;
  store?: Store;
}

export function createPinLookupLimiter(options: PinLookupLimiterOptions = {}) {
  const isTest = process.env.NODE_ENV === "test";
  const defaultLimit = isTest ? Number.MAX_SAFE_INTEGER : 10;

  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    limit: options.limit ?? defaultLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
    store: options.store ?? new RedisStore(),
    // Default (passOnStoreError: false) already fails closed — a store error
    // throws and propagates to the app's error handler as a 500, rather than
    // silently letting PIN-guessing requests through.
  });
}
