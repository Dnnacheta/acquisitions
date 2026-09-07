import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import winston from "winston";

config({ path: [".env.local", ".env"], quiet: true });

const logsDirectory = new URL("../../logs/", import.meta.url);
mkdirSync(logsDirectory, { recursive: true });

const consoleTransport = new winston.transports.Console({
  stderrLevels: ["error"],
  ...(process.env.NODE_ENV !== "production" && {
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "acquisitions" },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  transports: [
    consoleTransport,
    new winston.transports.File({
      filename: fileURLToPath(new URL("app.log", logsDirectory)),
      level: "info",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

export default logger;
