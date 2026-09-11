import { and, eq, gt, sql } from "drizzle-orm";
import db from "#config/database.js";
import logger from "#config/logger.js";
import protection from "#config/arcjet.js";
import { users } from "#model/user.model.js";
import { allowRequest } from "#utils/protection.js";
import { formatError, formatValidationError } from "#utils/format.js";
import { hashActionToken, sendAccountLink } from "#utils/account-tokens.js";
import { hashPassword } from "#utils/password.js";
import { clearCookie } from "#utils/cookies.js";
import {
  emailRequestSchema,
  actionTokenSchema,
  resetPasswordSchema,
} from "#validations/auth.validation.js";

const accepted = {
  message:
    "If the account is eligible, an email with instructions will be sent.",
};
const invalid = { message: "Invalid or expired link. Request a new one." };

async function requestLink(req, res, purpose) {
  res.set("Cache-Control", "no-store");
  if (!(await allowRequest(protection.recoveryProtection, req, res))) return;
  const parsed = emailRequestSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (user) await sendAccountLink(user, purpose);
  } catch {
    logger.error("Account email request failed", { purpose });
  }
  // Same response for missing, verified, throttled, and failed-delivery accounts.
  return res.status(202).json(accepted);
}

export const forgotPassword = (req, res) => requestLink(req, res, "reset");
export const requestEmailVerification = (req, res) =>
  requestLink(req, res, "verification");

export async function verifyEmail(req, res) {
  res.set("Cache-Control", "no-store");
  if (!(await allowRequest(protection.recoveryProtection, req, res))) return;
  const parsed = actionTokenSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  try {
    const [user] = await db
      .update(users)
      .set({
        emailVerifiedAt: new Date(),
        verificationTokenHash: null,
        verificationExpiresAt: null,
        verificationSentAt: null,
      })
      .where(
        and(
          eq(users.verificationTokenHash, hashActionToken(parsed.data.token)),
          gt(users.verificationExpiresAt, new Date()),
        ),
      )
      .returning({ id: users.id });
    if (!user) return res.status(400).json(invalid);
    return res.status(200).json({ message: "Email verified successfully" });
  } catch (error) {
    logger.error("Email verification failed", { errorName: error.name });
    return res.status(500).json(formatError(error));
  }
}

export async function resetPassword(req, res) {
  res.set("Cache-Control", "no-store");
  if (!(await allowRequest(protection.recoveryProtection, req, res))) return;
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    // Token consumption, password replacement, and session revocation are atomic.
    const [user] = await db
      .update(users)
      .set({
        passwordHash,
        resetTokenHash: null,
        resetExpiresAt: null,
        resetSentAt: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(
        and(
          eq(users.resetTokenHash, hashActionToken(parsed.data.token)),
          gt(users.resetExpiresAt, new Date()),
        ),
      )
      .returning({ id: users.id });
    if (!user) return res.status(400).json(invalid);
    clearCookie(res, "token");
    return res.status(200).json({
      message: "Password reset successfully. Sign in with your new password.",
    });
  } catch (error) {
    logger.error("Password reset failed", { errorName: error.name });
    return res.status(500).json(formatError(error));
  }
}
