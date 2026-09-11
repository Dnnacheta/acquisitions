import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import db from "#config/database.js";
import logger from "#config/logger.js";
import { users } from "#model/user.model.js";
import email from "#utils/email.js";

export const hashActionToken = token =>
  createHash("sha256").update(token).digest("hex");

export async function sendAccountLink(user, purpose) {
  const verification = purpose === "verification";
  if (verification && user.emailVerifiedAt) return;
  const prefix = verification ? "verification" : "reset";
  const hashField = `${prefix}TokenHash`;
  const expiresField = `${prefix}ExpiresAt`;
  const sentField = `${prefix}SentAt`;
  const token = randomBytes(32).toString("hex");
  const hash = hashActionToken(token);
  let issued = false;
  try {
    const base = new URL(process.env.APP_BASE_URL);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      !["http:", "https:"].includes(base.protocol) ||
      (process.env.NODE_ENV === "production" && base.protocol !== "https:")
    ) {
      throw new Error("Invalid APP_BASE_URL");
    }
    const link = new URL(
      verification ? "/verify-email" : "/reset-password",
      base,
    );
    // Fragments are not sent in HTTP requests, access logs, or Referer headers.
    link.hash = `token=${token}`;
    const minutes = verification ? 1440 : 30;
    const [updated] = await db
      .update(users)
      .set({
        [hashField]: hash,
        [expiresField]: new Date(Date.now() + minutes * 60000),
        [sentField]: new Date(),
      })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.email, user.email),
          eq(users.passwordHash, user.passwordHash),
          verification ? isNull(users.emailVerifiedAt) : undefined,
          or(
            isNull(users[sentField]),
            lt(users[sentField], new Date(Date.now() - 60000)),
          ),
        ),
      )
      .returning({ id: users.id });
    if (!updated) return;
    issued = true;
    await email.send({
      to: user.email,
      subject: verification
        ? "Verify your Acquisitions email"
        : "Reset your Acquisitions password",
      text: `${verification ? "Confirm your email address" : "Choose a new password"}:\n${link.href}\n\nThis link expires in ${verification ? "24 hours" : "30 minutes"} and can only be used once. If you did not request this, ignore this email.`,
    });
  } catch {
    // Neither SMTP errors nor SQL errors may expose addresses, credentials, or tokens.
    logger.error("Account email delivery failed", { purpose });
    if (issued) {
      try {
        await db
          .update(users)
          .set({ [hashField]: null, [expiresField]: null, [sentField]: null })
          .where(and(eq(users.id, user.id), eq(users[hashField], hash)));
      } catch {
        logger.error("Account email token cleanup failed", { purpose });
      }
    }
  }
}
