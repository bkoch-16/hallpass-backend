import Redis from "ioredis";
import { logger } from "@hallpass/logger";
import { env } from "../env.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  logger.error(err, "[redis] connection error");
});
