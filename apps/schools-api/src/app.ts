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
  createRateLimitRedis,
} from "@hallpass/express-middleware";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { env } from "./env.js";
import districtRouter from "./routes/district.js";
import schoolRouter from "./routes/school.js";
import scheduleTypeRouter from "./routes/scheduleType.js";
import periodRouter from "./routes/period.js";
import calendarRouter from "./routes/calendar.js";
import destinationRouter from "./routes/destination.js";
import policyRouter from "./routes/policy.js";

const redis = createRateLimitRedis(env);

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

app.use(cors(corsOptions(env)));
app.options("/*splat", cors(corsOptions(env)));

app.use(httpLogger);
app.use(express.json());

// Registered before the rate limiter so LB/uptime probes are never 429'd
app.get("/health", createHealthRoute("schools-api"));

// Redis-backed store so limits aggregate across instances and survive cold
// starts; keys are namespaced by REDIS_PREFIX + service (shared Upstash DB).
// Skipped under test and when REDIS_URL is unset, falling back to
// express-rate-limit's in-memory store.
const useRedisStore = redis !== null && process.env.NODE_ENV !== "test";

const limiter = createGeneralLimiter(
  useRedisStore
    ? {
        store: new RedisStore({
          prefix: `${env.REDIS_PREFIX}:rl:schools-api:general:`,
          sendCommand: (command: string, ...args: string[]) =>
            redis!.call(command, ...args) as Promise<RedisReply>,
        }),
        passOnStoreError: true,
      }
    : {},
);

logger.info(`rate-limit store: ${useRedisStore ? "redis" : "in-memory"}`);

app.use(limiter);

// Nested sub-resource routers must be mounted on the school router
// with mergeParams so they can access :schoolId
scheduleTypeRouter.use("/:scheduleTypeId/periods", periodRouter);

schoolRouter.use("/:schoolId/schedule-types", scheduleTypeRouter);
schoolRouter.use("/:schoolId/calendar", calendarRouter);
schoolRouter.use("/:schoolId/destinations", destinationRouter);
schoolRouter.use("/:schoolId/policy", policyRouter);

app.use("/api/districts", districtRouter);
app.use("/api/schools", schoolRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
