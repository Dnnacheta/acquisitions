import { z } from "zod";
import { signUpSchema } from "./auth.validation.js";

const profile = signUpSchema.pick({ name: true, email: true });
const credentials = {
  role: z.enum(["user", "admin"]).optional(),
  password: signUpSchema.shape.password.optional(),
  currentPassword: z.string().min(1).max(128).optional(),
};

export const updateUserSchema = profile
  .partial()
  .extend(credentials)
  .refine(
    value =>
      [value.name, value.email, value.password, value.role].some(
        field => field !== undefined,
      ),
    { message: "Provide a name, email, password, or role to update" },
  );
export const replaceUserSchema = profile.extend(credentials);
export const createUserSchema = signUpSchema.extend({
  role: z.enum(["user", "admin"]).default("user"),
});
export const listUsersSchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(1000000))
    .default(1),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(100))
    .default(20),
});

export const userIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(
    value => Number.isSafeInteger(value) && value <= 2147483647,
    "Invalid user ID",
  );
