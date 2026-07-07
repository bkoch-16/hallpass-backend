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
}

/**
 * General API limiter: keys per authenticated user (req.user.id) so users
 * behind a shared IP (e.g. a school NAT) don't exhaust each other's quota,
 * falling back to per-IP keying for unauthenticated requests.
 * Defaults to 100 requests per 15-minute window per key.
 */
export function createGeneralLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit: options.limit ?? 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
    keyGenerator: (req: Request) =>
      req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? ""),
    ...(options.store ? { store: options.store } : {}),
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
  });
}
