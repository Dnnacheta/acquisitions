import { and, asc, eq } from "drizzle-orm";
import db from "#config/database.js";
import logger from "#config/logger.js";
import protection from "#config/arcjet.js";
import { users } from "#model/user.model.js";
import { clearCookie } from "#utils/cookies.js";
import { formatError, formatValidationError } from "#utils/format.js";
import { hashPassword, verifyPassword } from "#utils/password.js";
import { allowRequest } from "#utils/protection.js";
import {
  replaceUserSchema,
  updateUserSchema,
  userIdSchema,
  createUserSchema,
  listUsersSchema,
} from "#validations/user.validation.js";

const publicFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

async function authorize(req, res, adminOnly = false) {
  res.set("Cache-Control", "no-store");
  if (!(await allowRequest(protection.publicProtection, req, res)))
    return false;
  try {
    const [actor] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);
    if (!actor) {
      res.status(401).json({ message: "Account no longer exists" });
      return false;
    }
    req.user.role = actor.role;
  } catch (error) {
    handleError(res, error, "authorization");
    return false;
  }
  if (adminOnly && req.user.role !== "admin") {
    res.status(403).json({ message: "Administrator access required" });
    return false;
  }
  req.targetUserByIdId = req.user.id;
  if (req.params.id && req.params.id !== "me") {
    const id = userIdSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ message: "Invalid user ID" });
      return false;
    }
    if (id.data !== req.user.id && req.user.role !== "admin") {
      res.status(403).json({ message: "You can only manage your own account" });
      return false;
    }
    req.targetUserByIdId = id.data;
  }
  return true;
}

function handleError(res, error, operation) {
  if (error.code === "23505" || error.cause?.code === "23505") {
    return res.status(409).json({ message: "Email is already registered" });
  }
  logger.error(`User ${operation} failed`, { errorName: error.name });
  return res.status(500).json(formatError(error));
}

export async function getUserById(req, res) {
  if (!(await authorize(req, res))) return;
  try {
    const [user] = await db
      .select(publicFields)
      .from(users)
      .where(eq(users.id, req.targetUserByIdId))
      .limit(1);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ user });
  } catch (error) {
    return handleError(res, error, "read");
  }
}

export async function updateUser(req, res) {
  if (!(await authorize(req, res))) return;
  const schema = req.method === "PUT" ? replaceUserSchema : updateUserSchema;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  if (parsed.data.role !== undefined && req.user.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Only administrators can change roles" });
  }
  try {
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.targetUserByIdId))
      .limit(1);
    if (!record) return res.status(404).json({ message: "User not found" });
    const { name, email, password, currentPassword, role } = parsed.data;
    const sensitiveChange =
      password !== undefined || (email !== undefined && email !== record.email);
    if (
      sensitiveChange &&
      req.targetUserByIdId === req.user.id &&
      (!currentPassword ||
        !(await verifyPassword(currentPassword, record.passwordHash)))
    ) {
      return res.status(403).json({
        message:
          "Current password is required and must be correct to change email or password",
      });
    }
    const values = {};
    if (role !== undefined) values.role = role;
    if (name !== undefined) values.name = name;
    if (email !== undefined) values.email = email;
    if (password !== undefined)
      values.passwordHash = await hashPassword(password);
    // Reject concurrent credential changes rather than overwriting newer credentials.
    const [user] = await db
      .update(users)
      .set(values)
      .where(
        and(
          eq(users.id, req.targetUserByIdId),
          eq(users.passwordHash, record.passwordHash),
        ),
      )
      .returning(publicFields);
    if (!user)
      return res
        .status(409)
        .json({ message: "Account changed. Reload and try again." });
    return res.status(200).json({ message: "User updated successfully", user });
  } catch (error) {
    return handleError(res, error, "update");
  }
}

export async function deleteUser(req, res) {
  if (!(await authorize(req, res))) return;
  try {
    const [user] = await db
      .delete(users)
      .where(eq(users.id, req.targetUserByIdId))
      .returning({ id: users.id });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (req.targetUserByIdId === req.user.id) clearCookie(res, "token");
    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    return handleError(res, error, "delete");
  }
}

export async function createUser(req, res) {
  if (!(await authorize(req, res, true))) return;
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  try {
    const { name, email, password, role } = parsed.data;
    const [user] = await db
      .insert(users)
      .values({ name, email, role, passwordHash: await hashPassword(password) })
      .onConflictDoNothing({ target: users.email })
      .returning(publicFields);
    if (!user)
      return res.status(409).json({ message: "Email is already registered" });
    return res.status(201).json({ message: "User created successfully", user });
  } catch (error) {
    return handleError(res, error, "create");
  }
}

export async function listUsers(req, res) {
  if (!(await authorize(req, res, true))) return;
  const parsed = listUsersSchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json(formatValidationError(parsed.error));
  try {
    const { page, limit } = parsed.data;
    const records = await db
      .select(publicFields)
      .from(users)
      .orderBy(asc(users.id))
      .limit(limit + 1)
      .offset((page - 1) * limit);
    return res.status(200).json({
      users: records.slice(0, limit),
      page,
      limit,
      hasMore: records.length > limit,
    });
  } catch (error) {
    return handleError(res, error, "list");
  }
}
