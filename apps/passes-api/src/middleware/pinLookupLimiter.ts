import rateLimit, { ipKeyGenerator, Store, ClientRateLimitInfo } from "express-rate-limit";
import { Request } from "express";
import { redis } from "../lib/redis.js";
import { env } from "../env.js";

const KEY_PREFIX = `${env.REDIS_PREFIX}:rl:passes-api:parent-lookup:`;

// Atomically INCR the counter and, only on the first hit, set its window TTL,
// then return both the new count and the current PTTL in one round trip.
// INCR and PEXPIRE must be a single atomic step: if the process is killed
// (e.g. Cloud Run SIGTERM on deploy) between a separate INCR and PEXPIRE, the
// key is left at 1 with no TTL. On this shared `noeviction` Upstash instance
// that key would never expire, permanently rate-limiting the IP.
const LUA_INCREMENT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

// Atomically DECR the counter and delete the key once it reaches zero, so the
// undo path (skipSuccessfulRequests) can't leave a stray key or race a DEL
// against a concurrent DECR.
const LUA_DECREMENT = `
local count = redis.call('DECR', KEYS[1])
if count <= 0 then
  redis.call('DEL', KEYS[1])
end
`;

// Minimal ioredis-backed Store: INCR + PEXPIRE-on-first-increment. Shared
// across instances so the brake on PIN-guessing is meaningful across
// multiple server processes (unlike the default in-memory store).
export class RedisStore implements Store {
  windowMs = 15 * 60 * 1000;

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const [totalHits, ttl] = (await redis.eval(
      LUA_INCREMENT,
      1,
      redisKey,
      this.windowMs,
    )) as [number, number];
    const resetTime =
      ttl >= 0 ? new Date(Date.now() + ttl) : new Date(Date.now() + this.windowMs);
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await redis.eval(LUA_DECREMENT, 1, `${KEY_PREFIX}${key}`);
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
