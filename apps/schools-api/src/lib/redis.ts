import { createRequiredRedis } from "@hallpass/express-middleware";
import { env } from "../env.js";

export const redis = createRequiredRedis(env.REDIS_URL);
