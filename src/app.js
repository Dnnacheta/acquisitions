import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import logger from "#config/logger.js";
import authRouter from "#routes/auth.routes.js";
import protection from "#config/arcjet.js";
import { allowRequest } from "#utils/protection.js";

const app = express();

app.use(helmet());
app.use(
  morgan("tiny", {
    stream: {
      write: message => logger.info(message.trim()),
    },
  }),
);

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRouter);

app.get("/api", async (req, res) => {
  if (!(await allowRequest(protection.publicProtection, req, res))) return;
  res.status(200).json({ message: "Acquisitions API is running" });
});

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/", async (req, res) => {
  if (!(await allowRequest(protection.publicProtection, req, res))) return;
  res.status(200).send("Hello From Acquisitions!");
});

export default app;
