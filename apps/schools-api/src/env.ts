import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  PORT: z.string().optional(),
  CORS_ORIGIN: z.string().min(1),
});

export const env = envSchema.parse(process.env);
