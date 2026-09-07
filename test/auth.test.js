import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { after, before, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import request from "supertest";

// Never use local credentials or connect to the live database during tests.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.JWT_SECRET = randomBytes(48).toString("hex");
process.env.JWT_EXPIRES_IN = "1h";
process.env.NODE_ENV = "production";
process.env.ARCJET_KEY = "ajkey_test";

const { default: db, pool } = await import("#config/database.js");
const { default: logger } = await import("#config/logger.js");
const { users } = await import("#model/user.model.js");
const { verifyToken } = await import("#utils/jwt.js");
const { hashPassword, verifyPassword } = await import("#utils/password.js");
const { default: app } = await import("../src/app.js");
const { default: protectionClients } = await import("#config/arcjet.js");

// Never send test requests or credentials to Arcjet.
for (const name of Object.keys(protectionClients)) {
  protectionClients[name] = {
    protect: mock.fn(async () => ({
      isDenied: () => false,
      isErrored: () => false,
    })),
  };
}
const { publicProtection, signInProtection, signUpProtection } =
  protectionClients;

const client = new PGlite();
const testDb = drizzle(client);
const errorLog = mock.method(logger, "error", () => {});
mock.method(logger, "info", () => {});
mock.method(db, "insert", (...args) => testDb.insert(...args));
mock.method(db, "select", (...args) => testDb.select(...args));
// A regression that bypasses the isolated database must fail, not access Neon.
mock.method(pool, "query", () => {
  throw new Error("Live database access is forbidden in tests");
});
mock.method(pool, "connect", () => {
  throw new Error("Live database access is forbidden in tests");
});

const password = "  a long test passphrase  ";
const seedEmail = "existing@example.com";
let seedId;

before(async () => {
  await client.exec(
    await readFile(
      new URL("../drizzle/0000_rainy_colonel_america.sql", import.meta.url),
      "utf8",
    ),
  );
  const [seed] = await testDb
    .insert(users)
    .values({
      name: "Existing User",
      email: seedEmail,
      passwordHash: await hashPassword(password),
    })
    .returning({ id: users.id });
  seedId = seed.id;
});

after(async () => {
  mock.restoreAll();
  await client.close();
  await pool.end();
  const finished = once(logger, "finish");
  logger.end();
  await finished;
});

function assertSession(response, expectedId) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(verifyToken(response.body.token).sub, String(expectedId));
  assert.equal(response.body.user.passwordHash, undefined);
  assert.equal(response.body.user.password, undefined);
  const cookie = response.headers["set-cookie"].find(value =>
    value.startsWith("token="),
  );
  assert.ok(cookie.includes(response.body.token));
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
    assert.ok(cookie.includes(flag));
  }
}

test("sign-up creates a normalized user with a hashed password and session", async () => {
  const response = await request(app)
    .post("/api/auth/sign-up")
    .send({ name: " New User ", email: " NEW@EXAMPLE.COM ", password })
    .expect(201);
  const [stored] = await testDb
    .select()
    .from(users)
    .where(eq(users.email, "new@example.com"));
  assert.equal(stored.name, "New User");
  assert.notEqual(stored.passwordHash, password);
  assert.ok(await verifyPassword(password, stored.passwordHash));
  assertSession(response, stored.id);
});

test("validation rejects invalid fields and self-assigned admin roles", async () => {
  for (const body of [
    {},
    { name: " ", email: "bad", password: "short" },
    { name: "Test", email: "test@example.com", password, role: "admin" },
    { name: "Test", email: "test@example.com", password, passwordHash: "fake" },
  ]) {
    const response = await request(app)
      .post("/api/auth/sign-up")
      .send(body)
      .expect(400);
    assert.ok(response.body.errors.length > 0);
    assert.equal(response.headers["set-cookie"], undefined);
  }
});

test("concurrent duplicate sign-ups create only one account", async () => {
  const body = { name: "Race", email: "race@example.com", password };
  const responses = await Promise.all([
    request(app).post("/api/auth/sign-up").send(body),
    request(app).post("/api/auth/sign-up").send(body),
  ]);
  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [201, 409],
  );
  const stored = await testDb
    .select()
    .from(users)
    .where(eq(users.email, body.email));
  assert.equal(stored.length, 1);
});

test("sign-in normalizes email and returns a valid session", async () => {
  const response = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: ` ${seedEmail.toUpperCase()} `, password })
    .expect(200);
  assertSession(response, seedId);
});

test("unknown email and incorrect password return identical responses", async () => {
  const wrong = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: seedEmail, password: password.trim() })
    .expect(401);
  const missing = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: "missing@example.com", password })
    .expect(401);
  assert.deepEqual(wrong.body, missing.body);
  assert.equal(wrong.headers["set-cookie"], undefined);
  assert.equal(missing.headers["set-cookie"], undefined);
});

test("sign-in validation returns field errors", async () => {
  const response = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: "bad", password: "" })
    .expect(400);
  assert.deepEqual(
    response.body.errors.map(error => error.field),
    ["email", "password"],
  );
});

test("database failures are logged without leaking internal details", async () => {
  for (const [method, route, body, message] of [
    [
      "insert",
      "sign-up",
      { name: "Test", email: "fail@example.com", password },
      "Sign-up failed",
    ],
    ["select", "sign-in", { email: seedEmail, password }, "Sign-in failed"],
  ]) {
    const original = db[method];
    db[method] = () => {
      throw new Error("PRIVATE database details");
    };
    try {
      const response = await request(app)
        .post(`/api/auth/${route}`)
        .send(body)
        .expect(500);
      assert.equal(
        response.body.message,
        "Something went wrong. Please try again later.",
      );
      assert.equal(response.headers["set-cookie"], undefined);
      assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
        message,
        { errorName: "Error" },
      ]);
    } finally {
      db[method] = original;
    }
  }
});

test("sign-out expires the session cookie with matching security options", async () => {
  const signedIn = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: seedEmail, password })
    .expect(200);
  const response = await request(app)
    .post("/api/auth/sign-out")
    .set("Cookie", `token=${signedIn.body.token}`)
    .expect(200);
  assert.deepEqual(response.body, { message: "Signed out successfully" });
  assert.equal(response.headers["cache-control"], "no-store");
  const cookie = response.headers["set-cookie"][0];
  assert.ok(cookie.startsWith("token=;"));
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
    assert.ok(cookie.includes(flag));
  }
  assert.ok(cookie.includes("Expires=Thu, 01 Jan 1970"));
  // Clearing a cookie does not revoke stateless bearer tokens.
  assert.equal(verifyToken(signedIn.body.token).sub, String(seedId));
});

test("sign-out succeeds without a cookie and with an invalid cookie", async () => {
  for (const cookie of ["", "token=invalid"]) {
    const response = await request(app)
      .post("/api/auth/sign-out")
      .set("Cookie", cookie)
      .expect(200);
    assert.equal(response.body.message, "Signed out successfully");
  }
});

test("sign-out logs unexpected failures without leaking details", async () => {
  const failingClear = mock.method(app.response, "clearCookie", () => {
    throw new Error("PRIVATE cookie details");
  });
  try {
    const response = await request(app).post("/api/auth/sign-out").expect(500);
    assert.equal(
      response.body.message,
      "Something went wrong. Please try again later.",
    );
    assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
      "Sign-out failed",
      { errorName: "Error" },
    ]);
  } finally {
    failingClear.mock.restore();
  }
});

test("password hashes use independent salts", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(await verifyPassword(password, first));
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("Arcjet blocks each protected route before its handler performs work", async () => {
  for (const [method, route, protection] of [
    ["post", "/api/auth/sign-up", signUpProtection],
    ["post", "/api/auth/sign-in", signInProtection],
    ["post", "/api/auth/sign-out", publicProtection],
    ["get", "/api", publicProtection],
    ["get", "/", publicProtection],
  ]) {
    const original = protection.protect;
    const inserts = db.insert.mock.callCount();
    const selects = db.select.mock.callCount();
    const deny = mock.fn(async () => ({
      isDenied: () => true,
      reason: { isRateLimit: () => true },
    }));
    protection.protect = deny;
    try {
      const response = await request(app)[method](route).expect(429);
      assert.equal(deny.mock.callCount(), 1);
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(db.insert.mock.callCount(), inserts);
      assert.equal(db.select.mock.callCount(), selects);
    } finally {
      protection.protect = original;
    }
  }
});

test("health checks do not call Arcjet", async () => {
  const calls = publicProtection.protect.mock.callCount();
  const response = await request(app).get("/health").expect(200);
  assert.equal(response.body.status, "ok");
  assert.equal(publicProtection.protect.mock.callCount(), calls);
});
