import { eq } from "drizzle-orm";
import db from "#config/database.js";
import logger from "#config/logger.js";
import protection from "#config/arcjet.js";
import { users } from "#model/user.model.js";
import { clearCookie, setCookie } from "#utils/cookies.js";
import { formatError, formatValidationError } from "#utils/format.js";
import { signToken } from "#utils/jwt.js";
import { hashPassword, verifyPassword } from "#utils/password.js";
import { allowRequest } from "#utils/protection.js";
import { signInSchema, signUpSchema } from "#validations/auth.validation.js";

const publicFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

// Perform password hashing even when an email is not registered.
const dummyHash = `scrypt-v1$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function signOut(req, res) {
  if (!(await allowRequest(protection.publicProtection, req, res))) return;
  try {
    res.set("Cache-Control", "no-store");
    clearCookie(res, "token");
    return res.status(200).json({ message: "Signed out successfully" });
  } catch (error) {
    logger.error("Sign-out failed", { errorName: error.name });
    return res.status(500).json(formatError(error));
  }
}

function sendSession(res, status, message, user) {
  const token = signToken(user.id);
  res.set("Cache-Control", "no-store");
  setCookie(res, "token", token);
  return res.status(status).json({ message, user, token });
}

export async function signUp(req, res) {
  if (!(await allowRequest(protection.signUpProtection, req, res))) return;
  const result = signUpSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json(formatValidationError(result.error));
  }

  try {
    const { name, email, password } = result.data;
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning(publicFields);

    if (!user) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    return sendSession(res, 201, "Account created successfully", user);
  } catch (error) {
    logger.error("Sign-up failed", { errorName: error.name });
    return res.status(500).json(formatError(error));
  }
}

export async function signIn(req, res) {
  if (!(await allowRequest(protection.signInProtection, req, res))) return;
  const result = signInSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json(formatValidationError(result.error));
  }

  try {
    const { email, password } = result.data;
    const [record] = await db
      .select({ ...publicFields, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const passwordMatches = await verifyPassword(
      password,
      record?.passwordHash ?? dummyHash,
    );

    if (!record || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = { ...record };
    delete user.passwordHash;
    return sendSession(res, 200, "Signed in successfully", user);
  } catch (error) {
    logger.error("Sign-in failed", { errorName: error.name });
    return res.status(500).json(formatError(error));
  }
}
