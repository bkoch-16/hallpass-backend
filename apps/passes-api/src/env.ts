import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  PORT: z.coerce.number().optional().default(3003),
  CORS_ORIGIN: z.string().min(1),
  REDIS_URL: z.string().url(),
  INTERNAL_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
