import { createAuth } from "@hallpass/auth";
import { env } from "./env";

export const auth = createAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.CORS_ORIGIN === "*" ? undefined : env.CORS_ORIGIN.split(",").map((o) => o.trim()),
});
