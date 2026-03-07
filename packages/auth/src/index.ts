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
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    ...(config.baseURL.startsWith("https://") && {
      advanced: {
        // better-auth 1.4.7+ has a known bug where trustedOrigins is ignored,
        // causing all cross-origin requests to be rejected even when the origin
        // is explicitly listed. Since this API is cross-origin by design (frontend
        // on a different domain), and the Express CORS middleware already enforces
        // origin allowlisting via CORS_ORIGIN, disabling better-auth's redundant
        // origin check is safe. See: github.com/better-auth/better-auth/issues/6798
        disableCSRFCheck: true,
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
