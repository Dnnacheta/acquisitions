import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import logger from "./logger.js";

config({ path: [".env.local", ".env"], quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in the environment or .env.local");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 5000,
});

if (process.env.VERCEL === "1") attachDatabasePool(pool);

pool.on("error", () => {
  logger.error("Unexpected error on an idle PostgreSQL connection");
});

export const db = drizzle({ client: pool });

export default db;
