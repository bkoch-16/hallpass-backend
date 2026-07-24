import { createAuth } from "@hallpass/auth";
import { resetPasswordEmail } from "@hallpass/email";
import { prisma } from "@hallpass/db";
import { resolveTrustedOrigins } from "@hallpass/express-middleware";
import { logger } from "@hallpass/logger";
import { env } from "./env.js";
import { emailSender, resetPasswordUrl } from "./email.js";

export const auth = createAuth({
  prisma,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: resolveTrustedOrigins(env),
  sendResetPassword: async ({ user, token }) => {
    try {
      const message = resetPasswordEmail({
        name: user.name,
        url: resetPasswordUrl(token),
      });
      await emailSender.send({ to: user.email, ...message });
    } catch (err) {
      logger.error(err, `[auth] failed to send password reset email to user ${user.email}`);
    }
  },
});
