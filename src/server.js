import app from "./app.js";
import logger from "./config/logger.js";
import { pool } from "./config/database.js";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(`Listening on http://localhost:${server.address().port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down", { signal });
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(async error => {
    try {
      if (error) throw error;
      await pool.end();
      logger.on("finish", () => process.exit(0));
      logger.end();
    } catch (error) {
      logger.error("Shutdown failed", { errorName: error.name });
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
