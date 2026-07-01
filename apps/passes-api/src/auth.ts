import { createAuth } from "@hallpass/auth";
import { env } from "./env.js";
import { corsOrigins } from "./lib/cors.js";

export const auth = createAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins:
    env.CORS_ORIGIN === "*"
      ? undefined
      : (corsOrigins as string[]),
});
