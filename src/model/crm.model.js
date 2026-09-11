import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./user.model.js";

export const leadStage = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);
export const customerStatus = pgEnum("customer_status", ["active", "inactive"]);
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    company: varchar("company", { length: 255 }).default("").notNull(),
    phone: varchar("phone", { length: 50 }).default("").notNull(),
    status: customerStatus("status").default("active").notNull(),
    notes: text("notes").default("").notNull(),
    ...timestamps(),
  },
  table => [index("customers_owner_idx").on(table.ownerId)],
);

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    contactName: varchar("contact_name", { length: 255 }).default("").notNull(),
    email: varchar("email", { length: 255 }).default("").notNull(),
    company: varchar("company", { length: 255 }).default("").notNull(),
    source: varchar("source", { length: 100 }).default("Website").notNull(),
    value: numeric("value", { precision: 14, scale: 2 }).default("0").notNull(),
    stage: leadStage("stage").default("new").notNull(),
    followUpDate: date("follow_up_date", { mode: "string" }),
    notes: text("notes").default("").notNull(),
    ...timestamps(),
  },
  table => [
    index("leads_owner_stage_idx").on(table.ownerId, table.stage),
    index("leads_customer_idx").on(table.customerId),
  ],
);
