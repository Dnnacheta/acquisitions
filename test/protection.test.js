import assert from "node:assert/strict";
import { once } from "node:events";
import { after, mock, test } from "node:test";
import logger from "#config/logger.js";
import { allowRequest } from "#utils/protection.js";

const warnings = mock.method(logger, "warn", () => {});

after(async () => {
  mock.restoreAll();
  const finished = once(logger, "finish");
  logger.end();
  await finished;
});

function response() {
  const res = {
    set: mock.fn(() => res),
    status: mock.fn(() => res),
    json: mock.fn(() => res),
  };
  return res;
}

test("allowed requests are checked exactly once without writing a response", async () => {
  const req = { method: "GET", url: "/api" };
  const res = response();
  const client = {
    protect: mock.fn(async () => ({
      isDenied: () => false,
      isErrored: () => false,
    })),
  };
  assert.equal(await allowRequest(client, req, res), true);
  assert.equal(client.protect.mock.callCount(), 1);
  assert.deepEqual(client.protect.mock.calls[0].arguments, [req]);
  assert.equal(res.status.mock.callCount(), 0);
  assert.equal(res.json.mock.callCount(), 0);
});

test("rate limits return 429 with a retry time and no cache", async t => {
  t.mock.method(Date, "now", () => 100000);
  const res = response();
  const client = {
    protect: async () => ({
      isDenied: () => true,
      reason: { isRateLimit: () => true, resetTime: new Date(160000) },
    }),
  };
  assert.equal(await allowRequest(client, {}, res), false);
  assert.deepEqual(res.status.mock.calls[0].arguments, [429]);
  assert.deepEqual(
    res.set.mock.calls.map(call => call.arguments),
    [
      ["Cache-Control", "no-store"],
      ["Retry-After", "60"],
    ],
  );
  assert.deepEqual(res.json.mock.calls[0].arguments, [
    { message: "Too many requests. Try again later." },
  ]);
});

test("bot and Shield denials return a generic 403", async () => {
  const res = response();
  const client = {
    protect: async () => ({
      isDenied: () => true,
      reason: { isRateLimit: () => false },
    }),
  };
  assert.equal(await allowRequest(client, {}, res), false);
  assert.deepEqual(res.status.mock.calls[0].arguments, [403]);
  assert.deepEqual(res.json.mock.calls[0].arguments, [
    { message: "Forbidden" },
  ]);
});

test("Arcjet error decisions are logged and fail open", async () => {
  const res = response();
  const client = {
    protect: async () => ({
      id: "test-decision",
      isDenied: () => false,
      isErrored: () => true,
    }),
  };
  assert.equal(await allowRequest(client, {}, res), true);
  assert.equal(res.status.mock.callCount(), 0);
  assert.deepEqual(warnings.mock.calls.at(-1).arguments, [
    "Arcjet protection unavailable",
    { decisionId: "test-decision" },
  ]);
});

test("Arcjet exceptions fail open without logging sensitive error details", async () => {
  const res = response();
  const client = {
    protect: async () => {
      throw new Error("PRIVATE request or credential details");
    },
  };
  assert.equal(await allowRequest(client, {}, res), true);
  assert.equal(res.status.mock.callCount(), 0);
  assert.deepEqual(warnings.mock.calls.at(-1).arguments, [
    "Arcjet protection failed",
    { errorName: "Error" },
  ]);
});
