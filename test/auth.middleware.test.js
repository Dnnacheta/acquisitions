import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, mock, test } from "node:test";
import jwt from "jsonwebtoken";

// Set an isolated signing secret before loading the middleware and JWT utility.
process.env.JWT_SECRET = randomBytes(48).toString("hex");
process.env.JWT_EXPIRES_IN = "1h";

const { default: authenticate } =
  await import("#middleware/auth.middleware.js");
const { signToken } = await import("#utils/jwt.js");
const { default: logger } = await import("#config/logger.js");
mock.method(logger, "error", () => {});

after(async () => {
  mock.restoreAll();
  const finished = once(logger, "finish");
  logger.end();
  await finished;
});

function invoke(authorization) {
  const req = {
    get: name => (name === "Authorization" ? authorization : undefined),
  };
  const res = {
    set: mock.fn(() => res),
    status: mock.fn(() => res),
    json: mock.fn(() => res),
  };
  const next = mock.fn();
  authenticate(req, res, next);
  return { req, res, next };
}

function assertRejected(authorization, message) {
  const { req, res, next } = invoke(authorization);
  assert.equal(next.mock.callCount(), 0);
  assert.equal(req.user, undefined);
  assert.deepEqual(
    res.set.mock.calls.map(call => call.arguments),
    [["WWW-Authenticate", "Bearer"]],
  );
  assert.deepEqual(
    res.status.mock.calls.map(call => call.arguments),
    [[401]],
  );
  assert.deepEqual(
    res.json.mock.calls.map(call => call.arguments),
    [[{ message }]],
  );
}

for (const scheme of ["Bearer", "bEaReR"]) {
  test(`authentication accepts a valid token with ${scheme} scheme`, () => {
    const { req, res, next } = invoke(`${scheme} ${signToken(42)}`);
    assert.deepEqual(req.user, { id: 42 });
    assert.equal(next.mock.callCount(), 1);
    assert.deepEqual(next.mock.calls[0].arguments, []);
    assert.equal(res.set.mock.callCount(), 0);
    assert.equal(res.status.mock.callCount(), 0);
    assert.equal(res.json.mock.callCount(), 0);
  });
}

for (const [label, header] of [
  ["missing", undefined],
  ["empty", ""],
  ["wrong scheme", "Basic credentials"],
  ["missing token", "Bearer"],
  ["blank token", "Bearer   "],
  ["extra credentials", "Bearer token extra"],
]) {
  test(`authentication rejects ${label} authorization`, () => {
    assertRejected(header, "Authentication required");
  });
}

function signedToken(options = {}, secret = process.env.JWT_SECRET) {
  return jwt.sign({}, secret, {
    algorithm: "HS256",
    subject: "42",
    issuer: "acquisitions",
    audience: "acquisitions-api",
    expiresIn: "1h",
    ...options,
  });
}

for (const [label, token] of [
  ["malformed", () => "not-a-jwt"],
  ["invalid signature", () => signedToken({}, randomBytes(48).toString("hex"))],
  ["expired", () => signedToken({ expiresIn: -60 })],
  ["wrong issuer", () => signedToken({ issuer: "another-service" })],
  ["wrong audience", () => signedToken({ audience: "another-api" })],
  ["unsupported algorithm", () => signedToken({ algorithm: "HS384" })],
  ["invalid user ID", () => signedToken({ subject: "not-an-id" })],
]) {
  test(`authentication rejects a token with ${label} credentials`, () => {
    assertRejected(`Bearer ${token()}`, "Invalid or expired token");
  });
}
