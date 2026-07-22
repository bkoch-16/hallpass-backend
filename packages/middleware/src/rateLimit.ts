import { createHash } from "node:crypto";
import type { Request } from "express";
import { rateLimit, ipKeyGenerator, type Store } from "express-rate-limit";
import type Redis from "ioredis";
import { createRedisRateLimitStore } from "./redis.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Extract the better-auth session token from a request without a DB lookup or a
 * runtime dependency on better-auth: the `Authorization: Bearer` token (the
 * `bearer()` plugin is enabled), else a cookie whose name contains
 * `session_token` (matches `better-auth.session_token` and its `__Secure-` /
 * `__Host-` prefixed forms). Returns undefined for anonymous requests.
 */
function sessionToken(req: Request): string | undefined {
  const authz = req.headers.authorization;
  if (typeof authz === "string" && authz.startsWith("Bearer ")) {
    const token = authz.slice(7).trim();
    if (token) return token;
  }
  const cookie = req.headers.cookie;
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name.includes("session_token")) {
        const value = part.slice(eq + 1).trim();
        if (value) {
          try {
            return decodeURIComponent(value);
          } catch {
            // Malformed percent-encoding in attacker-controlled input — skip this
            // cookie rather than letting URIError escape the keyGenerator as a 500.
            continue;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Key a request by its session (hashed, so raw tokens never become store keys or
 * hit logs) when authenticated, else by IP. Keeping the token out of req.user
 * means this works before any auth middleware runs — no DB round trip.
 */
function sessionOrIpKey(req: Request): string {
  const token = sessionToken(req);
  return token
    ? `sess:${createHash("sha256").update(token).digest("hex")}`
    : ipKeyGenerator(req.ip ?? "");
}

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

/** Options forwarded to rateLimit() only when explicitly provided, so express-rate-limit's defaults (in-memory store, fail-closed) stay in effect otherwise. */
function storeOverrides(options: RateLimiterOptions) {
  return {
    ...(options.store ? { store: options.store } : {}),
    ...(options.passOnStoreError !== undefined
      ? { passOnStoreError: options.passOnStoreError }
      : {}),
  };
}

/**
 * General API limiter: keys per session (a hash of the better-auth session
 * token) so users behind a shared IP (e.g. a school NAT) don't exhaust each
 * other's quota, falling back to per-IP keying for anonymous requests. Keying
 * off the token rather than req.user means it works before any auth middleware
 * runs (the limiter is mounted globally, ahead of the per-route requireAuth).
 *
 * Trade-off: a client sending any token gets its own bucket, so per-token
 * keying does not bound an attacker who rotates fake tokens (requireAuth still
 * rejects them). Acceptable for cheap, DB-free per-user fairness; add a coarse
 * per-IP backstop if DoS hardening is ever needed.
 *
 * Defaults to 100 requests per 15-minute window per key. Under
 * NODE_ENV === "test" the default limit is Number.MAX_SAFE_INTEGER so supertest
 * suites sharing one counter per file never 429; pass an explicit `limit` to
 * exercise rate limiting in tests.
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
    keyGenerator: sessionOrIpKey,
    ...storeOverrides(options),
  });
}

/** Normalizes req.body.email (trim + lowercase) the same way for both auth limiters, else "". */
function normalizedEmail(req: Request): string {
  return typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
}

/**
 * Auth endpoint limiter: keys per (target account, source IP) pair so a
 * single IP spraying credential-stuffing attempts at one account is capped,
 * falling back to per-IP keying when no email is present. Requires
 * express.json() to run first. Defaults to 10 requests per 15-minute window
 * per key.
 *
 * Previously keyed on email alone, which let an attacker submit junk
 * credentials for a victim's email from anywhere and 429-lock that victim's
 * own sign-in attempts (account-lockout griefing) — see tech-debt.md. Keying
 * on (email, IP) means a griefer only exhausts their own IP's bucket for that
 * email; the victim's legitimate attempts from their own IP get an
 * independent counter. See createAuthAccountLimiter for the complementary
 * pure-email backstop against an attacker who rotates source IPs.
 */
export function createAuthLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit: options.limit ?? 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
    keyGenerator: (req: Request) => {
      const email = normalizedEmail(req);
      return email
        ? `email:${email}|ip:${ipKeyGenerator(req.ip ?? "")}`
        : ipKeyGenerator(req.ip ?? "");
    },
    ...storeOverrides(options),
  });
}

/**
 * Auth account limiter: keys purely on the target account (req.body.email,
 * normalized the same way as createAuthLimiter), falling back to per-IP
 * keying when no email is present. Requires express.json() to run first.
 *
 * This is the distributed-attack backstop for createAuthLimiter's per-(email,
 * IP) bucket: an attacker rotating source IPs gets a fresh per-IP counter
 * from createAuthLimiter each time, but still shares this single per-email
 * counter across all of those IPs, capping the aggregate attempts against one
 * account regardless of how many IPs are used.
 *
 * Intentionally LOOSER than createAuthLimiter's default (30 vs. 10 per
 * 15-minute window) so legitimate users who sign in from multiple networks
 * (e.g. home + mobile data) aren't penalized for normal behavior — it's meant
 * to catch distributed abuse, not everyday multi-IP usage.
 */
export function createAuthAccountLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit: options.limit ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
    keyGenerator: (req: Request) => {
      const email = normalizedEmail(req);
      return email ? `email:${email}` : ipKeyGenerator(req.ip ?? "");
    },
    ...storeOverrides(options),
  });
}

export interface IpRateLimiterOptions {
  /** Redis client used to build the default store. Ignored when `store` is provided. */
  redis: Redis;
  /** Key prefix passed to createRedisRateLimitStore, e.g. `${env.REDIS_PREFIX}:rl:passes-api:parent-lookup:`. Ignored when `store` is provided. */
  keyPrefix: string;
  /** Window length in milliseconds. Defaults to 15 minutes. */
  windowMs?: number;
  /** Explicit limit override (e.g. forwarded from a call site's own options). Takes precedence over defaultLimit/testLimit. */
  limit?: number;
  /** Production default requests-per-window when `limit` is not given. App-specific (e.g. 10 for passes-api's PIN lookup, 60 for schools-api's public data). */
  defaultLimit: number;
  /** Limit used instead of defaultLimit when NODE_ENV === "test". Defaults to Number.MAX_SAFE_INTEGER so supertest suites sharing one counter per file never 429; pass an explicit `limit` to exercise rate limiting in tests. */
  testLimit?: number;
  /** Skip counting successful (2xx) responses toward quota. Defaults to false (count every request). */
  skipSuccessfulRequests?: boolean;
  /** External store override, e.g. a FakeStore in unit tests — bypasses redis/keyPrefix. */
  store?: Store;
}

/**
 * Shared IP-keyed rate limiter for public, unauthenticated endpoints (PIN
 * lookup, public school data). Keys purely by IP — callers needing
 * session-aware keying should use createGeneralLimiter/createAuthLimiter
 * instead.
 *
 * Default (passOnStoreError: false) already fails closed — a store error
 * throws and propagates to the app's error handler as a 500, rather than
 * silently letting unlimited traffic through.
 */
export function createIpRateLimiter(options: IpRateLimiterOptions) {
  const isTest = process.env.NODE_ENV === "test";
  const resolvedDefault = isTest
    ? options.testLimit ?? Number.MAX_SAFE_INTEGER
    : options.defaultLimit;

  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES_MS,
    limit: options.limit ?? resolvedDefault,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(options.skipSuccessfulRequests ? { skipSuccessfulRequests: true } : {}),
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
    store: options.store ?? createRedisRateLimitStore(options.redis, options.keyPrefix),
  });
}
