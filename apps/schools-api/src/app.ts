import { logger } from "@hallpass/logger";
import {
  createBaseApp,
  notFound,
  createErrorHandler,
  createGeneralLimiter,
  createRedisRateLimitStore,
} from "@hallpass/express-middleware";
import { env } from "./env.js";
import { redis } from "./lib/redis.js";
import districtRouter from "./routes/district.js";
import schoolRouter from "./routes/school.js";
import scheduleTypeRouter from "./routes/scheduleType.js";
import periodRouter from "./routes/period.js";
import calendarRouter from "./routes/calendar.js";
import destinationRouter from "./routes/destination.js";
import policyRouter from "./routes/policy.js";
import scheduleRouter from "./routes/schedule.js";

const app = createBaseApp("schools-api", env);

// Redis-backed store so limits aggregate across instances and survive cold
// starts; keys are namespaced by REDIS_PREFIX + service (shared Upstash DB).
// Skipped under test so app tests keep express-rate-limit's in-memory
// default and never need a live Redis server.
const useRedisStore = process.env.NODE_ENV !== "test";

const limiter = createGeneralLimiter(
  useRedisStore
    ? {
        store: createRedisRateLimitStore(redis, `${env.REDIS_PREFIX}:rl:schools-api:general:`),
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
schoolRouter.use("/:schoolId/schedule", scheduleRouter);

app.use("/api/districts", districtRouter);
app.use("/api/schools", schoolRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
