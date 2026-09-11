import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: userRole("role").default("user").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  sessionVersion: integer("session_version").default(0).notNull(),
  verificationTokenHash: text("verification_token_hash").unique(),
  verificationExpiresAt: timestamp("verification_expires_at", {
    withTimezone: true,
  }),
  verificationSentAt: timestamp("verification_sent_at", { withTimezone: true }),
  resetTokenHash: text("reset_token_hash").unique(),
  resetExpiresAt: timestamp("reset_expires_at", { withTimezone: true }),
  resetSentAt: timestamp("reset_sent_at", { withTimezone: true }),
  // Hash passwords before inserting or updating this field.
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
