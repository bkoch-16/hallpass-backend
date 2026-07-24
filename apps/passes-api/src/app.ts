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
import passesRouter from "./routes/passes.js";
import internalRouter from "./routes/internal.js";

const app = createBaseApp("passes-api", env);

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
