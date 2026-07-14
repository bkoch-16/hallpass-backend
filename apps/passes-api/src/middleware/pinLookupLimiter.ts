import rateLimit, { ipKeyGenerator, Store } from "express-rate-limit";
import { Request } from "express";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { redis } from "../lib/redis.js";
import { env } from "../env.js";

const KEY_PREFIX = `${env.REDIS_PREFIX}:rl:passes-api:parent-lookup:`;

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
    store: options.store ?? new RedisStore({
      prefix: KEY_PREFIX,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    // Default (passOnStoreError: false) already fails closed — a store error
    // throws and propagates to the app's error handler as a 500, rather than
    // silently letting PIN-guessing requests through.
  });
}
