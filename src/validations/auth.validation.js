import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, "Email must be at most 255 characters")
  .pipe(z.email({ error: "Enter a valid email address" }));

// Preserve passwords exactly as entered, including whitespace.
const passwordSchema = z
  .string()
  .max(128, "Password must be at most 128 characters");

export const signUpSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(255, "Name must be at most 255 characters"),
  email: emailSchema,
  password: passwordSchema.min(8, "Password must be at least 8 characters"),
  role: z.enum(["user", "admin"]).default("user"),
});

export const signInSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema.min(1, "Password is required"),
});

export const emailRequestSchema = z.strictObject({ email: emailSchema });
export const actionTokenSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid token"),
});
export const resetPasswordSchema = actionTokenSchema.extend({
  password: passwordSchema.min(8, "Password must be at least 8 characters"),
});
