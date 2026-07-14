import { rateLimitEnvSchema } from "@hallpass/express-middleware";

export const env = rateLimitEnvSchema.parse(process.env);
