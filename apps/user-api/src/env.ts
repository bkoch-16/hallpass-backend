import { baseEnvSchema } from "@hallpass/express-middleware";

export const env = baseEnvSchema.parse(process.env);
