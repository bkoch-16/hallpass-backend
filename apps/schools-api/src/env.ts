import { z } from "zod";
import { baseEnvSchema } from "@hallpass/express-middleware";

const envSchema = baseEnvSchema.extend({
  REDIS_URL: z.string().url(),
  // Namespaces all Redis keys (rate-limit) — dev and prod share a single
  // Upstash database (free tier), so each environment MUST set a distinct
  // prefix ("dev" / "prod"; "local" for local dev). Required with no
  // default: a missing value fails at boot rather than silently colliding
  // with another environment's keys.
  REDIS_PREFIX: z.string().min(1),
  // Shared with passes-api's parent-lookup endpoint — the same trusted
  // external caller (voice-AI agent) uses this key to access the public
  // calendar/schedule-type endpoints without a session.
  PARENT_TOOL_API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
