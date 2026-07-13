import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

type PrismaLike = Parameters<typeof prismaAdapter>[0];

export function createAuth(config: {
  prisma: PrismaLike;
  baseURL: string;
  secret: string;
  trustedOrigins?: string[];
}) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: prismaAdapter(config.prisma, {
      provider: "postgresql",
    }),
    plugins: [bearer()],
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false },
        schoolId: { type: "number", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    advanced: {
      database: {
        generateId: "serial",
      },
      ...(config.baseURL.startsWith("https://") && {
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
        },
      }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export { toNodeHandler, fromNodeHeaders };

export class EmailInUseError extends Error {
  constructor() {
    super("Email already in use");
    this.name = "EmailInUseError";
  }
}

export async function createUserWithCredential(
  auth: Auth,
  input: { email: string; password: string; name: string; role?: string; schoolId?: number | null },
) {
  const ctx = await auth.$context;
  const email = input.email.toLowerCase();
  if ((await ctx.internalAdapter.findUserByEmail(email))?.user) throw new EmailInUseError();
  const hash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser({
    email,
    name: input.name,
    emailVerified: false,
    ...(input.role ? { role: input.role } : {}),
    ...(input.schoolId !== undefined ? { schoolId: input.schoolId } : {}),
  });
  await ctx.internalAdapter.linkAccount({
    userId: String(user.id),
    providerId: "credential",
    accountId: String(user.id),
    password: hash,
  });
  return { ...user, id: Number(user.id) };
}
