import express from "express";
import cors from "cors";
import helmet from "helmet";
import { toNodeHandler } from "@hallpass/auth";
import { logger, httpLogger } from "@hallpass/logger";
import {
  createHealthRoute,
  notFound,
  createErrorHandler,
  createGeneralLimiter,
  createAuthLimiter,
  createAuthAccountLimiter,
  corsOptions,
  createRateLimitRedis,
  createRedisRateLimitStore,
} from "@hallpass/express-middleware";
import { auth } from "./auth.js";
import { env } from "./env.js";
import userRouter from "./routes/user.js";

const redis = createRateLimitRedis(env);

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

app.use(cors(corsOptions(env)));
app.options("/*splat", cors(corsOptions(env)));

app.use(httpLogger);
app.use(express.json());

// Registered before the rate limiter so LB/uptime probes are never 429'd
app.get("/health", createHealthRoute("user-api"));

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

logger.info(`rate-limit store: ${useRedisStore ? "redis" : "in-memory"}`);

app.use(limiter);
// Strict auth limiter applies only to credential-sensitive better-auth
// endpoints; GET /api/auth/get-session and everything else ride the general
// limiter above, keyed per session rather than a shared-NAT IP bucket.
// Two-layer defense: authLimiter caps attempts per (email, IP) so a single
// source can't grief a victim's account into lockout, while
// authAccountLimiter is a looser pure-email backstop that still caps the
// aggregate across an attacker rotating source IPs. authAccountLimiter is
// scoped to only the routes that carry req.body.email — reset-password
// ({ newPassword, token }) and change-password ({ currentPassword,
// newPassword }) never do, so its keyGenerator would fall back to the same
// per-IP key authLimiter already uses, and authLimiter's stricter 10-request
// cap runs first and always blocks before authAccountLimiter's looser
// 30-request cap could ever bind — making it dead weight (a redundant Redis
// round-trip) on those two routes.
app.post(
  [
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password",
    "/api/auth/change-password",
  ],
  authLimiter,
);
app.post(
  [
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
  ],
  authAccountLimiter,
);
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use("/api/users", userRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
