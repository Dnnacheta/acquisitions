import { z } from "zod";
import { userIdSchema } from "./user.validation.js";

const name = z.string().trim().min(1).max(255);
const optionalText = max => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
export const stages = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
];
export const customerSchema = z.strictObject({
  name,
  email,
  company: optionalText(255).default(""),
  phone: optionalText(50).default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  notes: optionalText(5000).default(""),
});
export const leadSchema = z.strictObject({
  title: name,
  contactName: optionalText(255).default(""),
  email: z.union([email, z.literal("")]).default(""),
  company: optionalText(255).default(""),
  source: optionalText(100).default("Website"),
  value: z
    .number()
    .finite()
    .min(0)
    .max(99999999999)
    .multipleOf(0.01)
    .default(0),
  stage: z.enum(stages).default("new"),
  customerId: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .nullable()
    .default(null),
  followUpDate: z.iso.date().nullable().default(null),
  notes: optionalText(5000).default(""),
});
const nonempty = schema =>
  z
    .strictObject(
      Object.fromEntries(
        Object.entries(schema.shape).map(([key, field]) => [
          key,
          (field instanceof z.ZodDefault
            ? field.removeDefault()
            : field
          ).optional(),
        ]),
      ),
    )
    .refine(value => Object.keys(value).length > 0, {
      message: "Provide at least one field to update",
    });
export const updateCustomerSchema = nonempty(customerSchema);
export const updateLeadSchema = nonempty(leadSchema);
export const recordIdSchema = userIdSchema;
const pagination = {
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
  search: z.string().trim().max(100).default(""),
};
export const customerListSchema = z.strictObject({
  ...pagination,
  status: z.enum(["active", "inactive"]).optional(),
});
export const leadListSchema = z.strictObject({
  ...pagination,
  stage: z.enum(stages).optional(),
});
