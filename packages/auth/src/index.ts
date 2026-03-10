import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { prisma } from "@hallpass/db";

export function createAuth(config: { baseURL: string; secret: string; trustedOrigins?: string[] }) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      generateId: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    ...(config.baseURL.startsWith("https://") && {
      advanced: {
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
        },
      },
    }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export { toNodeHandler, fromNodeHeaders };
