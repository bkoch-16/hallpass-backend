import Redis from "ioredis";
import { logger } from "@hallpass/logger";
import { env } from "../env.js";

// Rate-limit store only. Null when REDIS_URL is unset (local `pnpm dev`, tests),
// in which case the limiters fall back to express-rate-limit's in-memory store.
export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })
  : null;

redis?.on("error", (err) => {
  logger.error(err, "[redis] connection error");
});
