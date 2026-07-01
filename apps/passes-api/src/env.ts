import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  BETTER_AUTH_URL: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  PORT: z.coerce.number().optional().default(3003),
  CORS_ORIGIN: z.string(),
  REDIS_URL: z.string().url(),
  INTERNAL_SECRET: z.string(),
});

export const env = envSchema.parse(process.env);
