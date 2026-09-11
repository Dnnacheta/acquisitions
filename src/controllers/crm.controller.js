import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import db from "#config/database.js";
import logger from "#config/logger.js";
import protection from "#config/arcjet.js";
import { users } from "#model/user.model.js";
import { customers, leads } from "#model/crm.model.js";
import { allowRequest } from "#utils/protection.js";
import { formatValidationError } from "#utils/format.js";
import {
  customerSchema,
  customerListSchema,
  updateCustomerSchema,
  leadSchema,
  leadListSchema,
  updateLeadSchema,
  recordIdSchema,
} from "#validations/crm.validation.js";

const configs = {
  customers: {
    table: customers,
    create: customerSchema,
    update: updateCustomerSchema,
    list: customerListSchema,
    searchFields: [customers.name, customers.email, customers.company],
    filter: "status",
  },
  leads: {
    table: leads,
    create: leadSchema,
    update: updateLeadSchema,
    list: leadListSchema,
    searchFields: [leads.title, leads.contactName, leads.email, leads.company],
    filter: "stage",
  },
};
const access = (table, actor) =>
  actor.role === "admin" ? undefined : eq(table.ownerId, actor.id);

async function authorize(req, res) {
  res.set("Cache-Control", "no-store");
  if (!(await allowRequest(protection.publicProtection, req, res))) return null;
  const [actor] = await db
    .select({
      id: users.id,
      role: users.role,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(eq(users.id, req.user.id))
    .limit(1);
  if (!actor || actor.sessionVersion !== req.sessionVersion) {
    res.status(401).json({ message: "Invalid or expired token" });
    return null;
  }
  return actor;
}
function failure(res, error, operation) {
  logger.error("CRM operation failed", { operation, errorName: error.name });
  if (error.code === "23503" || error.cause?.code === "23503")
    return res
      .status(409)
      .json({ message: "A linked record changed. Reload and try again." });
  return res
    .status(500)
    .json({ message: "Unable to complete this request. Please try again." });
}
function parse(schema, value, res) {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json(formatValidationError(result.error));
    return null;
  }
  return result.data;
}
async function validCustomer(customerId, ownerId) {
  if (customerId === null || customerId === undefined) return true;
  const [customer] = await db
    .select({ ownerId: customers.ownerId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return Boolean(customer && customer.ownerId === ownerId);
}

// Both resources use the same authorization, error handling, and pagination rules.
export function resourceHandlers(resource) {
  const config = configs[resource];
  const { table } = config;
  const handle = (operation, action) => async (req, res) => {
    try {
      const actor = await authorize(req, res);
      if (actor) await action(req, res, actor);
    } catch (error) {
      return failure(res, error, `${resource}.${operation}`);
    }
  };
  return {
    list: handle("list", async (req, res, actor) => {
      const query = parse(config.list, req.query, res);
      if (!query) return;
      const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      const where = and(
        access(table, actor),
        query.search
          ? or(...config.searchFields.map(field => ilike(field, pattern)))
          : undefined,
        query[config.filter]
          ? eq(table[config.filter], query[config.filter])
          : undefined,
      );
      const [total] = await db
        .select({ count: count() })
        .from(table)
        .where(where);
      const records = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);
      res.json({
        [resource]: records,
        total: total.count,
        page: query.page,
        limit: query.limit,
        hasMore: query.page * query.limit < total.count,
      });
    }),
    create: handle("create", async (req, res, actor) => {
      const data = parse(config.create, req.body, res);
      if (!data) return;
      if (
        resource === "leads" &&
        !(await validCustomer(data.customerId, actor.id))
      )
        return res.status(400).json({
          message: "Select a customer owned by this record's salesperson.",
        });
      const [record] = await db
        .insert(table)
        .values({
          ...data,
          ownerId: actor.id,
          ...(resource === "leads" ? { value: String(data.value) } : {}),
        })
        .returning();
      res.status(201).json({ record });
    }),
    get: handle("read", async (req, res, actor) => {
      const id = parse(recordIdSchema, req.params.id, res);
      if (!id) return;
      const [record] = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), access(table, actor)))
        .limit(1);
      if (!record) return res.status(404).json({ message: "Record not found" });
      res.json({ record });
    }),
    update: handle("update", async (req, res, actor) => {
      const id = parse(recordIdSchema, req.params.id, res);
      if (!id) return;
      const data = parse(config.update, req.body, res);
      if (!data) return;
      const where = and(eq(table.id, id), access(table, actor));
      const [existing] = await db.select().from(table).where(where).limit(1);
      if (!existing)
        return res.status(404).json({ message: "Record not found" });
      if (
        resource === "leads" &&
        !(await validCustomer(data.customerId, existing.ownerId))
      )
        return res.status(400).json({
          message: "Select a customer owned by this record's salesperson.",
        });
      const [record] = await db
        .update(table)
        .set({
          ...data,
          ...(data.value !== undefined ? { value: String(data.value) } : {}),
        })
        .where(where)
        .returning();
      if (!record) return res.status(404).json({ message: "Record not found" });
      res.json({ record });
    }),
    delete: handle("delete", async (req, res, actor) => {
      const id = parse(recordIdSchema, req.params.id, res);
      if (!id) return;
      const [record] = await db
        .delete(table)
        .where(and(eq(table.id, id), access(table, actor)))
        .returning({ id: table.id });
      if (!record) return res.status(404).json({ message: "Record not found" });
      res.json({ message: "Record deleted successfully" });
    }),
  };
}

export async function overview(req, res) {
  try {
    const actor = await authorize(req, res);
    if (!actor) return;
    const [customerCount] = await db
      .select({ count: count() })
      .from(customers)
      .where(access(customers, actor));
    const pipeline = await db
      .select({
        stage: leads.stage,
        count: count(),
        value: sql`coalesce(sum(${leads.value}), 0)`,
      })
      .from(leads)
      .where(access(leads, actor))
      .groupBy(leads.stage);
    const recentLeads = await db
      .select()
      .from(leads)
      .where(access(leads, actor))
      .orderBy(desc(leads.updatedAt), desc(leads.id))
      .limit(5);
    const followUps = await db
      .select()
      .from(leads)
      .where(
        and(
          access(leads, actor),
          sql`${leads.followUpDate} is not null`,
          sql`${leads.stage} not in ('won', 'lost')`,
        ),
      )
      .orderBy(leads.followUpDate, leads.id)
      .limit(5);
    res.json({
      customers: customerCount.count,
      pipeline,
      recentLeads,
      followUps,
    });
  } catch (error) {
    return failure(res, error, "overview");
  }
}
