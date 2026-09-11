import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("Vercel logging avoids file transports even when file logging is requested", () => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const { default: logger } = await import('./src/config/logger.js');
    assert.equal(logger.transports.length, 1);
    assert.equal(logger.transports[0].name, 'console');
    logger.end();
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, VERCEL: "1", LOG_TO_FILE: "true" },
      timeout: 10000,
    },
  );
});
