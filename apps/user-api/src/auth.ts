import { createAuth } from "@hallpass/auth";
import { prisma } from "@hallpass/db";
import { parseCorsOrigins } from "@hallpass/express-middleware";
import { env } from "./env.js";

const origins = parseCorsOrigins(env);

export const auth = createAuth({
  prisma,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // "*" (allow-all) maps to undefined — better-auth's trustedOrigins only accepts a concrete list
  trustedOrigins: Array.isArray(origins) ? origins : undefined,
});
