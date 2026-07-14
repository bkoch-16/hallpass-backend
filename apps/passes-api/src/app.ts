import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger, httpLogger } from "@hallpass/logger";
import {
  createHealthRoute,
  notFound,
  createErrorHandler,
  createGeneralLimiter,
  corsOptions,
  createRedisRateLimitStore,
} from "@hallpass/express-middleware";
import { env } from "./env.js";
import { redis } from "./lib/redis.js";
import passesRouter from "./routes/passes.js";
import internalRouter from "./routes/internal.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

app.use(cors(corsOptions(env)));
app.options("/*splat", cors(corsOptions(env)));

app.use(httpLogger);
app.use(express.json());

// Registered before the rate limiter so LB/uptime probes are never 429'd
app.get("/health", createHealthRoute("passes-api"));

// Redis-backed store so limits aggregate across instances and survive
// restarts; keys are namespaced under REDIS_PREFIX (shared Upstash DB).
// Skipped under test (NODE_ENV === "test", the convention used in
// @hallpass/logger) so app tests keep express-rate-limit's in-memory default
// and never need a live Redis server. If more limiters are added, each needs
// its own RedisStore instance (rate-limit-redis stores can't be shared).
const limiter = createGeneralLimiter(
  process.env.NODE_ENV === "test"
    ? {}
    : {
        store: createRedisRateLimitStore(redis, `${env.REDIS_PREFIX}:rl:passes-api:general:`),
        // fail-open — an Upstash outage must not take down the API; slots/queue paths have their own Redis dependency semantics
        passOnStoreError: true,
      },
);

app.use(limiter);

app.use("/api/passes", passesRouter);
app.use("/internal", internalRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
