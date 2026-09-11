import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import logger from "#config/logger.js";
import authRouter from "#routes/auth.routes.js";
import crmRouter from "#routes/crm.routes.js";
import userRouter from "#routes/user.routes.js";
import protection from "#config/arcjet.js";
import { allowRequest } from "#utils/protection.js";

morgan.token("safe-path", req => req.path);
const app = express();

app.use(helmet());
app.use(
  morgan(
    ":method :safe-path :status :res[content-length] - :response-time ms",
    {
      stream: {
        write: message => logger.info(message.trim()),
      },
    },
  ),
);

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get(["/verify-email", "/reset-password"], (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(
    fileURLToPath(new URL("./public/account.html", import.meta.url)),
  );
});
app.use(
  "/account-assets",
  express.static(
    fileURLToPath(new URL("../public/account-assets", import.meta.url)),
  ),
);

app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/crm", crmRouter);

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

app.use(
  "/crm-assets",
  express.static(
    fileURLToPath(new URL("../public/crm-assets", import.meta.url)),
  ),
);
app.get("/", async (req, res) => {
  if (!(await allowRequest(protection.publicProtection, req, res))) return;
  res.set("Cache-Control", "no-store");
  res.sendFile(fileURLToPath(new URL("./public/crm.html", import.meta.url)));
});

export default app;
