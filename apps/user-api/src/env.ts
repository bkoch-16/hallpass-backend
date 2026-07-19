import { rateLimitEnvSchema } from "@hallpass/express-middleware";
import { z } from "zod";

/**
 * SES email fields, user-api only (it is the sole service that sends email).
 * All-or-nothing: with the full set, password-reset emails go out via SES;
 * with none, @hallpass/email falls back to logging the message (local dev,
 * tests). WEB_APP_URL is where reset links point and is required whenever
 * SES is configured.
 */
const emailEnvSchema = z
  .object({
    AWS_REGION: z.string().min(1).optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    WEB_APP_URL: z.string().url().optional(),
  })
  .refine(
    (d) => {
      const ses = [
        d.AWS_REGION,
        d.AWS_ACCESS_KEY_ID,
        d.AWS_SECRET_ACCESS_KEY,
        d.EMAIL_FROM,
      ];
      return ses.every(Boolean) || ses.every((v) => !v);
    },
    {
      message:
        "AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and EMAIL_FROM must be set together",
    },
  )
  .refine((d) => !d.EMAIL_FROM || Boolean(d.WEB_APP_URL), {
    message: "WEB_APP_URL is required when SES email is configured",
  });

export const env = {
  ...rateLimitEnvSchema.parse(process.env),
  ...emailEnvSchema.parse(process.env),
};
