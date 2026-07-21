import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { logger } from "@hallpass/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SesConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  from: string;
}

/**
 * With a full SES config, returns a real SESv2 sender. Without one (local
 * dev, tests, CI), returns a fallback that logs the message instead of
 * sending — so email-triggering flows work everywhere with zero AWS setup.
 */
export function createEmailSender(config?: SesConfig): EmailSender {
  if (!config) {
    return {
      async send(message) {
        logger.info(
          { to: message.to, subject: message.subject, text: message.text },
          "email not sent (SES not configured)",
        );
      },
    };
  }

  const client = new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async send(message) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: config.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject },
              Body: {
                Text: { Data: message.text },
                Html: { Data: message.html },
              },
            },
          },
        }),
      );
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function resetPasswordEmail(input: {
  name: string | null;
  url: string;
}): Omit<EmailMessage, "to"> {
  const name = input.name?.trim() || "there";
  return {
    subject: "Reset your Hallpass password",
    text: [
      `Hi ${name},`,
      "",
      "Someone requested a password reset for your Hallpass account.",
      "If this was you, open the link below to choose a new password:",
      "",
      input.url,
      "",
      "The link expires in one hour. If you didn't request this, you can ignore this email — your password is unchanged.",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(name)},</p>`,
      "<p>Someone requested a password reset for your Hallpass account. If this was you, click the link below to choose a new password:</p>",
      `<p><a href="${escapeHtml(input.url)}">Reset your password</a></p>`,
      "<p>The link expires in one hour. If you didn't request this, you can ignore this email — your password is unchanged.</p>",
    ].join("\n"),
  };
}

export function inviteEmail(input: {
  name: string | null;
  url: string;
  expiresInDays: number;
}): Omit<EmailMessage, "to"> {
  const name = input.name?.trim() || "there";
  const expiryText = `The link expires in ${input.expiresInDays} day${input.expiresInDays === 1 ? "" : "s"}.`;
  return {
    subject: "You've been invited to Hallpass",
    text: [
      `Hi ${name},`,
      "",
      "An account was created for you on Hallpass. Open the link below to set your password:",
      "",
      input.url,
      "",
      expiryText,
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(name)},</p>`,
      "<p>An account was created for you on Hallpass. Click the link below to set your password:</p>",
      `<p><a href="${escapeHtml(input.url)}">Set your password</a></p>`,
      `<p>${expiryText}</p>`,
    ].join("\n"),
  };
}
