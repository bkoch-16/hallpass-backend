import { createEmailSender } from "@hallpass/email";
import { env } from "./env.js";

function sesConfig() {
  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM } =
    env;
  if (
    !AWS_REGION ||
    !AWS_ACCESS_KEY_ID ||
    !AWS_SECRET_ACCESS_KEY ||
    !EMAIL_FROM
  )
    return undefined;
  return {
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    from: EMAIL_FROM,
  };
}

export const emailSender = createEmailSender(sesConfig());

export function resetPasswordUrl(token: string): string {
  const base = (env.WEB_APP_URL ?? "http://localhost:8080").replace(/\/+$/, "");
  return `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
}
