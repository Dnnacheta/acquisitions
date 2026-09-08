import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(
    `server serves health and shuts down cleanly on ${signal}`,
    { timeout: 15000 },
    async () => {
      const child = spawn(process.execPath, ["src/index.js"], {
        env: {
          ...process.env,
          PORT: "0",
          NODE_ENV: "production",
          LOG_TO_FILE: "false",
          LOG_LEVEL: "info",
          DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
          JWT_SECRET: "test-secret-".repeat(4),
          ARCJET_KEY: "ajkey_test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      let output = "";
      let errors = "";
      child.stderr.on("data", chunk => {
        errors += chunk;
      });
      try {
        const port = await new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", () =>
            reject(new Error(`Server exited before startup: ${errors}`)),
          );
          child.stdout.on("data", chunk => {
            output += chunk;
            const match = output.match(/Listening on http:\/\/localhost:(\d+)/);
            if (match) resolve(match[1]);
          });
        });
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "ok");
        child.kill(signal);
        const [code, exitSignal] = await exited;
        assert.equal(code, 0, errors);
        assert.equal(exitSignal, null);
        assert.match(output, /Shutting down/);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
  );
}
