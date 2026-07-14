import { createAuth } from "@hallpass/auth";
import { prisma } from "@hallpass/db";
import { parseCorsOrigins } from "@hallpass/express-middleware";
import { env } from "./env.js";

export const auth = createAuth({
  prisma,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins:
    env.CORS_ORIGIN === "*"
      ? undefined
      : (parseCorsOrigins(env) as string[]),
});
