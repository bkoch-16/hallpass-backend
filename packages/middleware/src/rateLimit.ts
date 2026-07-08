import type { Request } from "express";
import { rateLimit, ipKeyGenerator, type Store } from "express-rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface RateLimiterOptions {
  /** Window length in milliseconds. Defaults to 15 minutes. */
  windowMs?: number;
  /** Max requests per key per window. Defaults per factory (100 general, 10 auth). */
  limit?: number;
  /** External store (e.g. Redis). Defaults to express-rate-limit's in-memory store. */
  store?: Store;
  /** Let requests through if the store errors (fail-open). Defaults to express-rate-limit's false (fail-closed). */
  passOnStoreError?: boolean;
}

/**
 * General API limiter: keys per authenticated user (req.user.id) so users
 * behind a shared IP (e.g. a school NAT) don't exhaust each other's quota,
 * falling back to per-IP keying for unauthenticated requests.
 *
 * Note: per-user keying only applies when req.user is populated upstream of
 * the limiter. With the typical mount order (limiter in app.ts before any
 * auth middleware), req.user is never set at keying time, so general traffic
 * keys per-IP. Defaults to 100 requests per 15-minute window per key.
 * Under NODE_ENV === "test" the default limit is Number.MAX_SAFE_INTEGER so
 * supertest suites sharing one in-memory IP-keyed counter per file never
 * 429; pass an explicit `limit` to exercise rate limiting in tests.
 */
export function createGeneralLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit:
      options.limit ??
      (process.env.NODE_ENV === "test" ? Number.MAX_SAFE_INTEGER : 100),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
    keyGenerator: (req: Request) =>
      req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? ""),
    ...(options.store ? { store: options.store } : {}),
    ...(options.passOnStoreError !== undefined
      ? { passOnStoreError: options.passOnStoreError }
      : {}),
  });
}

/**
 * Auth endpoint limiter: keys per target account (req.body.email, lowercased
 * and trimmed) so credential-stuffing against one account can't be spread
 * across IPs, falling back to per-IP keying when no email is present.
 * Requires express.json() to run first. Defaults to 10 requests per
 * 15-minute window per key.
 */
export function createAuthLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit: options.limit ?? 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
    keyGenerator: (req: Request) => {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";
      return email ? `email:${email}` : ipKeyGenerator(req.ip ?? "");
    },
    ...(options.store ? { store: options.store } : {}),
    ...(options.passOnStoreError !== undefined
      ? { passOnStoreError: options.passOnStoreError }
      : {}),
  });
}
