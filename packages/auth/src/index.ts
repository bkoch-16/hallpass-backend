import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
// @ts-ignore
import { toNodeHandler } from "better-auth/node";
import { prisma } from "@hallpass/db";

export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
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
});

export { toNodeHandler };
export type Session = typeof auth.$Infer.Session;