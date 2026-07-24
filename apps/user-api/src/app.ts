import { toNodeHandler } from "@hallpass/auth";
import { logger } from "@hallpass/logger";
import {
  createBaseApp,
  notFound,
  createErrorHandler,
  createGeneralLimiter,
  createAuthLimiter,
  createAuthAccountLimiter,
  createRateLimitRedis,
  createRedisRateLimitStore,
} from "@hallpass/express-middleware";
import { auth } from "./auth.js";
import { env } from "./env.js";
import userRouter from "./routes/user.js";

const EMAIL_AUTH_ROUTES = ["/api/auth/sign-in/email", "/api/auth/sign-up/email"];
const PASSWORD_RESET_ROUTE = "/api/auth/request-password-reset";

const redis = createRateLimitRedis(env);

const app = createBaseApp("user-api", env);

// Redis-backed store so limits aggregate across instances and survive cold
// starts; keys are namespaced by REDIS_PREFIX + service (shared Upstash DB).
// Skipped under test and when REDIS_URL is unset, falling back to
// express-rate-limit's in-memory store. Each limiter needs its own RedisStore
// instance (rate-limit-redis stores can't be shared).
const useRedisStore = redis !== null && process.env.NODE_ENV !== "test";

function redisStore(suffix: string) {
  return createRedisRateLimitStore(redis!, `${env.REDIS_PREFIX}:rl:user-api:${suffix}:`);
}

const limiter = createGeneralLimiter(
  useRedisStore
    ? { store: redisStore("general"), passOnStoreError: true }
    : {},
);

const authLimiter = createAuthLimiter(
  useRedisStore ? { store: redisStore("auth"), passOnStoreError: true } : {},
);

const authAccountLimiter = createAuthAccountLimiter(
  useRedisStore ? { store: redisStore("auth-account"), passOnStoreError: true } : {},
);

// request-password-reset's better-auth handler always returns HTTP 200,
// success or failure, by design (anti-enumeration) — so "success" carries no
// signal here and must count toward the budget like a failure would
// elsewhere, or the cap never engages.
const authAccountLimiterForPasswordReset = createAuthAccountLimiter(
  useRedisStore
    ? {
        store: redisStore("auth-account-reset"),
        passOnStoreError: true,
        skipSuccessfulRequests: false,
      }
    : { skipSuccessfulRequests: false },
);

logger.info(`rate-limit store: ${useRedisStore ? "redis" : "in-memory"}`);

app.use(limiter);
// Strict auth limiter applies only to credential-sensitive better-auth
// endpoints; GET /api/auth/get-session and everything else ride the general
// limiter above, keyed per session rather than a shared-NAT IP bucket.
// Two-layer defense: authLimiter caps attempts per (email, IP) so a single
// source can't grief a victim's account into lockout, while the
// authAccountLimiter family is a looser pure-email backstop that still caps
// the aggregate across an attacker rotating source IPs. The account-limiter
// layer is scoped to only the routes that carry req.body.email —
// reset-password ({ newPassword, token }) and change-password
// ({ currentPassword, newPassword }) never do, so its keyGenerator would fall
// back to the same per-IP key authLimiter already uses, and authLimiter's
// stricter 10-request cap runs first and always blocks before the looser
// 30-request cap could ever bind — making it dead weight (a redundant Redis
// round-trip) on those two routes. It's split into two instances:
// authAccountLimiter (skip-successful) covers EMAIL_AUTH_ROUTES, since a real
// sign-in/sign-up success shouldn't erode the backstop; and
// authAccountLimiterForPasswordReset (count-everything) covers
// PASSWORD_RESET_ROUTE only, because that route's handler always returns 200
// regardless of outcome, so "success" carries no signal there.
app.post(
  [
    ...EMAIL_AUTH_ROUTES,
    PASSWORD_RESET_ROUTE,
    "/api/auth/reset-password",
    "/api/auth/change-password",
  ],
  authLimiter,
);
app.post(EMAIL_AUTH_ROUTES, authAccountLimiter);
app.post(PASSWORD_RESET_ROUTE, authAccountLimiterForPasswordReset);
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use("/api/users", userRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
