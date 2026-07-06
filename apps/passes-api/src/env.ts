import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  PORT: z.coerce.number().optional().default(3003),
  CORS_ORIGIN: z.string().min(1),
  REDIS_URL: z.string().url(),
  // Namespaces all Redis keys (BullMQ, slot counters, socket.io pub/sub) —
  // dev and prod share a single Upstash database (free tier), so each
  // environment must set a distinct prefix ("dev" / "prod")
  REDIS_PREFIX: z.string().min(1).default("local"),
  INTERNAL_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
