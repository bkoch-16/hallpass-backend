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
  corsOptions,
  createRateLimitRedis,
} from "@hallpass/express-middleware";
import { RedisStore, type RedisReply } from "rate-limit-redis";
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
  return new RedisStore({
    prefix: `${env.REDIS_PREFIX}:rl:user-api:${suffix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis!.call(command, ...args) as Promise<RedisReply>,
  });
}

const limiter = createGeneralLimiter(
  useRedisStore
    ? { store: redisStore("general"), passOnStoreError: true }
    : {},
);

const authLimiter = createAuthLimiter(
  useRedisStore ? { store: redisStore("auth"), passOnStoreError: true } : {},
);

logger.info(`rate-limit store: ${useRedisStore ? "redis" : "in-memory"}`);

app.use(limiter);
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));

app.use("/api/users", userRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
