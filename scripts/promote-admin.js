import { eq } from "drizzle-orm";
import db, { pool } from "../src/config/database.js";
import logger from "../src/config/logger.js";
import { users } from "../src/model/user.model.js";

// Operator-only bootstrap: requires direct access to the application's DB credentials.
try {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || process.argv.length !== 3) {
    throw new Error("Usage: npm run user:promote-admin -- user@example.com");
  }
  const [user] = await db
    .update(users)
    .set({ role: "admin" })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!user) throw new Error("No account found. Register the account first.");
  console.log(`User ${user.id} is now an administrator.`);
} catch (error) {
  console.error(
    error.cause
      ? "Admin promotion failed. Check the database configuration and migrations."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
  logger.end();
}
