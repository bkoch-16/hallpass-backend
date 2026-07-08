import { z } from "zod";
import { baseEnvSchema } from "@hallpass/express-middleware";

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().optional().default(3003),
  REDIS_URL: z.string().url(),
  // Namespaces all Redis keys (slot counters, rate-limit, socket.io pub/sub) —
  // dev and prod share a single Upstash database (free tier), so each
  // environment MUST set a distinct prefix ("dev" / "prod"; "local" for local dev).
  // Required with no default: a missing value fails at boot rather than
  // silently colliding with another environment's keys.
  REDIS_PREFIX: z.string().min(1),
  INTERNAL_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
