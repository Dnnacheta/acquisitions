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
process.env.APP_BASE_URL = "https://app.example.test";

const { default: db, pool } = await import("#config/database.js");
const { default: logger } = await import("#config/logger.js");
const { users } = await import("#model/user.model.js");
const { verifyToken, signToken } = await import("#utils/jwt.js");
const { hashPassword, verifyPassword } = await import("#utils/password.js");
const { default: app } = await import("../index.js");
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
const { default: emailDelivery } = await import("#utils/email.js");
const sentEmails = [];
mock.method(emailDelivery, "send", async message => {
  sentEmails.push(message);
});
const errorLog = mock.method(logger, "error", () => {});
mock.method(logger, "info", () => {});
mock.method(db, "insert", (...args) => testDb.insert(...args));
mock.method(db, "select", (...args) => testDb.select(...args));
mock.method(db, "update", (...args) => testDb.update(...args));
mock.method(db, "delete", (...args) => testDb.delete(...args));
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
  const journal = JSON.parse(
    await readFile(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  );
  for (const migration of journal.entries) {
    await client.exec(
      await readFile(
        new URL(`../drizzle/${migration.tag}.sql`, import.meta.url),
        "utf8",
      ),
    );
  }
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

test("validation rejects invalid fields and unknown roles", async () => {
  for (const body of [
    {},
    { name: " ", email: "bad", password: "short" },
    { name: "Test", email: "test@example.com", password, role: "owner" },
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

test("user CRUD creates, reads, updates, and deletes an owned account", async () => {
  const created = await request(app)
    .post("/api/auth/sign-up")
    .send({
      name: "CRUD User",
      email: "crud@example.com",
      password,
    })
    .expect(201);
  const id = created.body.user.id;
  const auth = `Bearer ${created.body.token}`;
  assertSession(created, id);
  for (const path of ["me", id]) {
    const response = await request(app)
      .get(`/api/users/${path}`)
      .set("Authorization", auth)
      .expect(200);
    assert.equal(response.body.user.id, id);
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const patched = await request(app)
    .patch("/api/users/me")
    .set("Authorization", auth)
    .send({ name: " Updated Name " })
    .expect(200);
  assert.equal(patched.body.user.name, "Updated Name");
  assert.equal(patched.body.user.email, "crud@example.com");
  const replaced = await request(app)
    .put(`/api/users/${id}`)
    .set("Authorization", auth)
    .send({
      name: "Final Name",
      email: " NEWCRUD@EXAMPLE.COM ",
      currentPassword: password,
    })
    .expect(200);
  assert.equal(replaced.body.user.email, "newcrud@example.com");
  const deleted = await request(app)
    .delete(`/api/users/${id}`)
    .set("Authorization", auth)
    .expect(200);
  assert.ok(deleted.headers["set-cookie"][0].startsWith("token=;"));
  assert.equal(
    (await testDb.select().from(users).where(eq(users.id, id))).length,
    0,
  );
  await request(app)
    .get("/api/users/me")
    .set("Authorization", auth)
    .expect(401);
  await request(app)
    .patch("/api/users/me")
    .set("Authorization", auth)
    .send({ name: "Restore" })
    .expect(401);
  await request(app)
    .delete("/api/users/me")
    .set("Authorization", auth)
    .expect(401);
  await request(app)
    .post("/api/auth/sign-in")
    .send({ email: "newcrud@example.com", password })
    .expect(401);
});

test("user routes require authentication and reject cross-account access", async () => {
  const auth = `Bearer ${signToken(seedId)}`;
  for (const method of ["get", "patch", "put", "delete"]) {
    await request(app)[method]("/api/users/me").expect(401);
    await request(app)
      [method]("/api/users/me")
      .set("Authorization", "Bearer invalid")
      .expect(401);
    await request(app)
      [method](`/api/users/${seedId + 1000}`)
      .set("Authorization", auth)
      .expect(403);
  }
  for (const id of ["0", "-1", "abc", "1.5", "2147483648"]) {
    await request(app)
      .get(`/api/users/${id}`)
      .set("Authorization", auth)
      .expect(400);
  }
});

test("user update validation rejects empty updates, invalid fields, and privileged fields", async () => {
  const auth = `Bearer ${signToken(seedId)}`;
  for (const body of [
    {},
    { name: " " },
    { email: "invalid" },
    { password: "short" },
    { id: seedId + 1 },
    { passwordHash: "fake" },
    { createdAt: "2020-01-01" },
    { currentPassword: password },
  ]) {
    await request(app)
      .patch("/api/users/me")
      .set("Authorization", auth)
      .send(body)
      .expect(400);
  }
  await request(app)
    .put("/api/users/me")
    .set("Authorization", auth)
    .send({ name: "Only Name" })
    .expect(400);
});

test("email and password changes require the correct current password", async () => {
  const auth = `Bearer ${signToken(seedId)}`;
  for (const change of [
    { email: "changed@example.com" },
    { password: "new long password" },
  ]) {
    for (const currentPassword of [undefined, "wrong password"]) {
      await request(app)
        .patch("/api/users/me")
        .set("Authorization", auth)
        .send({ ...change, currentPassword })
        .expect(403);
    }
  }
});

test("duplicate email updates return 409 without changing the account", async () => {
  const auth = `Bearer ${signToken(seedId)}`;
  await request(app)
    .patch("/api/users/me")
    .set("Authorization", auth)
    .send({ email: "new@example.com", currentPassword: password })
    .expect(409);
  const [record] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, seedId));
  assert.equal(record.email, seedEmail);
});

test("password updates store a hash and change sign-in credentials", async () => {
  const created = await request(app)
    .post("/api/auth/sign-up")
    .send({
      name: "Password User",
      email: "password-crud@example.com",
      password,
    })
    .expect(201);
  const newPassword = "  replacement password  ";
  const response = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${created.body.token}`)
    .send({ password: newPassword, currentPassword: password })
    .expect(200);
  assert.equal(response.body.user.passwordHash, undefined);
  const [record] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, created.body.user.id));
  assert.notEqual(record.passwordHash, newPassword);
  assert.ok(await verifyPassword(newPassword, record.passwordHash));
  await request(app)
    .post("/api/auth/sign-in")
    .send({ email: record.email, password })
    .expect(401);
  await request(app)
    .post("/api/auth/sign-in")
    .send({ email: record.email, password: newPassword })
    .expect(200);
});

test("Arcjet user denials prevent reads, updates, and deletes", async () => {
  const original = publicProtection.protect;
  publicProtection.protect = async () => ({
    isDenied: () => true,
    reason: { isRateLimit: () => true },
  });
  const counts = [db.select, db.update, db.delete].map(fn =>
    fn.mock.callCount(),
  );
  try {
    for (const method of ["get", "patch", "put", "delete"]) {
      await request(app)
        [method]("/api/users/me")
        .set("Authorization", `Bearer ${signToken(seedId)}`)
        .expect(429);
    }
    assert.deepEqual(
      [db.select, db.update, db.delete].map(fn => fn.mock.callCount()),
      counts,
    );
  } finally {
    publicProtection.protect = original;
  }
});

test("all user database failures are logged without leaking private details", async () => {
  const admin = await createTestAdmin("error-tests@example.com");
  for (const [method, path, dbMethod, operation, body, skip] of [
    ["get", "/me", "select", "authorization", {}, 0],
    ["get", "/me", "select", "read", {}, 1],
    ["get", "", "select", "list", {}, 1],
    [
      "post",
      "",
      "insert",
      "create",
      { name: "New", email: "failure@example.com", password },
      0,
    ],
    ["patch", "/me", "update", "update", { name: "Updated" }, 0],
    ["delete", "/me", "delete", "delete", {}, 0],
  ]) {
    const original = db[dbMethod];
    let calls = 0;
    db[dbMethod] = (...args) => {
      if (calls++ < skip) return original.apply(db, args);
      throw new Error("PRIVATE database details");
    };
    const logCount = errorLog.mock.callCount();
    try {
      const response = await request(app)
        [method](`/api/users${path}`)
        .set("Authorization", admin.authorization)
        .send(body)
        .expect(500);
      assert.deepEqual(response.body, {
        message: "Something went wrong. Please try again later.",
      });
      assert.equal(errorLog.mock.callCount(), logCount + 1);
      assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
        `User ${operation} failed`,
        { errorName: "Error" },
      ]);
    } finally {
      db[dbMethod] = original;
    }
  }
});

async function createTestAdmin(email) {
  const [admin] = await testDb
    .insert(users)
    .values({
      name: "Admin",
      email,
      role: "admin",
      passwordHash: await hashPassword(password),
    })
    .returning({ id: users.id });
  return { id: admin.id, authorization: `Bearer ${signToken(admin.id)}` };
}

test("regular users cannot list, create users, or assign roles", async () => {
  const auth = `Bearer ${signToken(seedId)}`;
  await request(app).get("/api/users").expect(401);
  await request(app).post("/api/users").expect(401);
  await request(app).get("/api/users").set("Authorization", auth).expect(403);
  await request(app)
    .post("/api/users")
    .set("Authorization", auth)
    .send({
      name: "Admin",
      email: "denied@example.com",
      password,
      role: "admin",
    })
    .expect(403);
  await request(app)
    .patch("/api/users/me")
    .set("Authorization", auth)
    .send({ role: "admin" })
    .expect(403);
  const [record] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, seedId));
  assert.equal(record.role, "user");
});

test("admin can create, list, read, update roles and delete other users", async () => {
  const admin = await createTestAdmin("crud-admin@example.com");
  const created = await request(app)
    .post("/api/users")
    .set("Authorization", admin.authorization)
    .send({ name: "Managed", email: " MANAGED@EXAMPLE.COM ", password })
    .expect(201);
  assert.equal(created.body.user.role, "user");
  assert.equal(created.body.user.email, "managed@example.com");
  assert.equal(created.body.token, undefined);
  assert.equal(created.headers["set-cookie"], undefined);
  assert.equal(created.body.user.passwordHash, undefined);
  const id = created.body.user.id;
  const list = await request(app)
    .get("/api/users?page=1&limit=2")
    .set("Authorization", admin.authorization)
    .expect(200);
  assert.equal(list.body.users.length, 2);
  assert.equal(list.body.hasMore, true);
  assert.ok(list.body.users[0].id < list.body.users[1].id);
  assert.ok(list.body.users.every(user => user.passwordHash === undefined));
  await request(app)
    .get(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .expect(200);
  const updated = await request(app)
    .patch(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .send({ role: "admin", name: "Promoted", password: "admin-reset-password" })
    .expect(200);
  assert.equal(updated.body.user.role, "admin");
  await request(app)
    .post("/api/auth/sign-in")
    .send({ email: "managed@example.com", password: "admin-reset-password" })
    .expect(200);
  const deleted = await request(app)
    .delete(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .expect(200);
  assert.equal(deleted.headers["set-cookie"], undefined);
  await request(app)
    .get(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .expect(404);
  await request(app)
    .patch(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .send({ name: "Missing" })
    .expect(404);
  await request(app)
    .delete(`/api/users/${id}`)
    .set("Authorization", admin.authorization)
    .expect(404);
});

test("admin creation supports explicit roles and rejects duplicates and bad roles", async () => {
  const admin = await createTestAdmin("validation-admin@example.com");
  const response = await request(app)
    .post("/api/users")
    .set("Authorization", admin.authorization)
    .send({
      name: "Second Admin",
      email: "second-admin@example.com",
      password,
      role: "admin",
    })
    .expect(201);
  assert.equal(response.body.user.role, "admin");
  await request(app)
    .post("/api/users")
    .set("Authorization", admin.authorization)
    .send({ name: "Duplicate", email: " SECOND-ADMIN@EXAMPLE.COM ", password })
    .expect(409);
  await request(app)
    .post("/api/users")
    .set("Authorization", admin.authorization)
    .send({
      name: "Bad",
      email: "bad-role@example.com",
      password,
      role: "superadmin",
    })
    .expect(400);
  for (const query of [
    "page=0",
    "limit=101",
    "limit=-1",
    "page=abc",
    "role=admin",
  ]) {
    await request(app)
      .get(`/api/users?${query}`)
      .set("Authorization", admin.authorization)
      .expect(400);
  }
  const defaults = await request(app)
    .get("/api/users")
    .set("Authorization", admin.authorization)
    .expect(200);
  assert.equal(defaults.body.page, 1);
  assert.equal(defaults.body.limit, 20);
});

test("database role changes and deleted accounts take effect with existing tokens", async () => {
  const operator = await createTestAdmin("operator@example.com");
  const other = await createTestAdmin("demoted@example.com");
  await request(app)
    .get("/api/users")
    .set("Authorization", other.authorization)
    .expect(200);
  await request(app)
    .patch(`/api/users/${other.id}`)
    .set("Authorization", operator.authorization)
    .send({ role: "user" })
    .expect(200);
  await request(app)
    .get("/api/users")
    .set("Authorization", other.authorization)
    .expect(403);
  await request(app)
    .delete(`/api/users/${other.id}`)
    .set("Authorization", operator.authorization)
    .expect(200);
  await request(app)
    .get("/api/users/me")
    .set("Authorization", other.authorization)
    .expect(401);
});

test("admin signup requires the configured key and creates an admin session", async () => {
  const previous = process.env.ADMIN_SIGNUP_KEY;
  const body = {
    name: "Signup Admin",
    email: "signup-admin@example.com",
    password,
    role: "admin",
  };
  try {
    delete process.env.ADMIN_SIGNUP_KEY;
    await request(app)
      .post("/api/auth/sign-up")
      .set("X-Admin-Signup-Key", "test-key")
      .send(body)
      .expect(403);
    process.env.ADMIN_SIGNUP_KEY = "test-admin-signup-key";
    for (const key of ["", "wrong-key"]) {
      const response = await request(app)
        .post("/api/auth/sign-up")
        .set("X-Admin-Signup-Key", key)
        .send(body)
        .expect(403);
      assert.equal(response.headers["set-cookie"], undefined);
    }
    const response = await request(app)
      .post("/api/auth/sign-up")
      .set("X-Admin-Signup-Key", process.env.ADMIN_SIGNUP_KEY)
      .send(body)
      .expect(201);
    assert.equal(response.body.user.role, "admin");
    assert.equal(response.body.user.passwordHash, undefined);
    assert.ok(
      !JSON.stringify(response.body).includes(process.env.ADMIN_SIGNUP_KEY),
    );
    await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${response.body.token}`)
      .expect(200);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SIGNUP_KEY;
    else process.env.ADMIN_SIGNUP_KEY = previous;
  }
});

function emailToken(message = sentEmails.at(-1)) {
  const url = message.text.match(/https:\/\/[^\s]+/)[0];
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
}

async function recoveryUser(label) {
  const response = await request(app)
    .post("/api/auth/sign-up")
    .send({
      name: "Recovery",
      email: `${label}@example.com`,
      password,
    })
    .expect(201);
  return response.body;
}

test("signup sends a hashed, expiring verification link consumed only once", async () => {
  const { user } = await recoveryUser("verify-flow");
  assert.equal(user.emailVerifiedAt, null);
  const token = emailToken();
  const [stored] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, user.id));
  assert.notEqual(stored.verificationTokenHash, token);
  assert.equal(stored.verificationTokenHash.length, 64);
  assert.ok(stored.verificationExpiresAt > new Date());
  assert.equal(user.verificationTokenHash, undefined);
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token, password: "replacement password" })
    .expect(400);
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(app).post("/api/auth/verify-email").send({ token }),
    ),
  );
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  const [verified] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, user.id));
  assert.ok(verified.emailVerifiedAt);
  assert.equal(verified.verificationTokenHash, null);
});

test("password reset is single use, changes credentials and revokes existing sessions", async () => {
  const account = await recoveryUser("reset-flow");
  const response = await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: account.user.email })
    .expect(202);
  assert.equal(response.body.token, undefined);
  const token = emailToken();
  await request(app).post("/api/auth/verify-email").send({ token }).expect(400);
  const newPassword = "new reset passphrase";
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(app)
        .post("/api/auth/reset-password")
        .send({ token, password: newPassword }),
    ),
  );
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  await request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${account.token}`)
    .expect(401);
  await request(app)
    .post("/api/auth/sign-in")
    .send({ email: account.user.email, password })
    .expect(401);
  const signedIn = await request(app)
    .post("/api/auth/sign-in")
    .send({ email: account.user.email, password: newPassword })
    .expect(200);
  await request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${signedIn.body.token}`)
    .expect(200);
});

test("email requests hide account existence and enforce a per-account cooldown", async () => {
  const { user } = await recoveryUser("cooldown");
  for (const path of ["forgot-password", "request-email-verification"]) {
    const existing = await request(app)
      .post(`/api/auth/${path}`)
      .send({ email: user.email })
      .expect(202);
    const count = sentEmails.length;
    const repeated = await request(app)
      .post(`/api/auth/${path}`)
      .send({ email: user.email })
      .expect(202);
    const missing = await request(app)
      .post(`/api/auth/${path}`)
      .send({ email: "missing-recovery@example.com" })
      .expect(202);
    assert.deepEqual(existing.body, missing.body);
    assert.deepEqual(repeated.body, missing.body);
    assert.equal(sentEmails.length, count);
  }
});

test("expired and replaced action tokens cannot be consumed", async () => {
  const { user } = await recoveryUser("expired");
  const oldVerification = emailToken();
  await testDb
    .update(users)
    .set({
      verificationExpiresAt: new Date(0),
      verificationSentAt: new Date(0),
    })
    .where(eq(users.id, user.id));
  await request(app)
    .post("/api/auth/verify-email")
    .send({ token: oldVerification })
    .expect(400);
  await request(app)
    .post("/api/auth/request-email-verification")
    .send({ email: user.email })
    .expect(202);
  const newVerification = emailToken();
  assert.notEqual(oldVerification, newVerification);
  await request(app)
    .post("/api/auth/verify-email")
    .send({ token: oldVerification })
    .expect(400);
  await request(app)
    .post("/api/auth/verify-email")
    .send({ token: newVerification })
    .expect(200);
  await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: user.email })
    .expect(202);
  const resetToken = emailToken();
  await testDb
    .update(users)
    .set({ resetExpiresAt: new Date(0) })
    .where(eq(users.id, user.id));
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token: resetToken, password: "another password" })
    .expect(400);
});

test("email changes invalidate verification and outstanding recovery links", async () => {
  const account = await recoveryUser("email-change");
  const oldVerification = emailToken();
  await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: account.user.email })
    .expect(202);
  const oldReset = emailToken();
  await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${account.token}`)
    .send({ email: "new-email-change@example.com", currentPassword: password })
    .expect(200);
  await request(app)
    .post("/api/auth/verify-email")
    .send({ token: oldVerification })
    .expect(400);
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token: oldReset, password: "another password" })
    .expect(400);
  const [stored] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, account.user.id));
  assert.equal(stored.emailVerifiedAt, null);
});

test("recovery validates input and Arcjet denies before database or email work", async () => {
  for (const path of [
    "forgot-password",
    "request-email-verification",
    "verify-email",
    "reset-password",
  ]) {
    await request(app).post(`/api/auth/${path}`).send({}).expect(400);
  }
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token: "a".repeat(64), password: "short" })
    .expect(400);
  const original = protectionClients.recoveryProtection.protect;
  protectionClients.recoveryProtection.protect = async () => ({
    isDenied: () => true,
    reason: {
      isRateLimit: () => true,
      resetTime: new Date(Date.now() + 60000),
    },
  });
  const count = sentEmails.length;
  const selects = db.select.mock.callCount();
  try {
    for (const path of [
      "forgot-password",
      "request-email-verification",
      "verify-email",
      "reset-password",
    ]) {
      await request(app)
        .post(`/api/auth/${path}`)
        .send({ email: seedEmail })
        .expect(429);
    }
    assert.equal(sentEmails.length, count);
    assert.equal(db.select.mock.callCount(), selects);
  } finally {
    protectionClients.recoveryProtection.protect = original;
  }
});

test("delivery failures are private and permit retry without losing the account", async () => {
  const original = emailDelivery.send;
  emailDelivery.send = async () => {
    throw new Error("PRIVATE SMTP password");
  };
  try {
    const { user } = await recoveryUser("delivery-failure");
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email })
      .expect(202);
    assert.ok(!JSON.stringify(response.body).includes("PRIVATE"));
    const [stored] = await testDb
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(stored.resetTokenHash, null);
    assert.equal(stored.resetSentAt, null);
    assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
      "Account email delivery failed",
      { purpose: "reset" },
    ]);
  } finally {
    emailDelivery.send = original;
  }
});

test("account link pages load without consuming tokens", async () => {
  for (const path of ["verify-email", "reset-password"]) {
    const response = await request(app).get(`/${path}`).expect(200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.text, /account-form/);
    assert.match(
      response.headers["content-security-policy"],
      /script-src 'self'/,
    );
  }
  await request(app).get("/account-assets/account.js").expect(200);
});

test("action database failures log safe errors and do not consume tokens", async () => {
  const original = db.update;
  db.update = () => {
    throw new Error("PRIVATE SQL token");
  };
  try {
    for (const [path, operation] of [
      ["verify-email", "Email verification"],
      ["reset-password", "Password reset"],
    ]) {
      const response = await request(app)
        .post(`/api/auth/${path}`)
        .send({
          token: "a".repeat(64),
          ...(path === "reset-password"
            ? { password: "new password value" }
            : {}),
        })
        .expect(500);
      assert.deepEqual(response.body, {
        message: "Something went wrong. Please try again later.",
      });
      assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
        `${operation} failed`,
        { errorName: "Error" },
      ]);
    }
  } finally {
    db.update = original;
  }
});

test("verified accounts do not receive redundant verification emails", async () => {
  const { user } = await recoveryUser("already-verified");
  await request(app)
    .post("/api/auth/verify-email")
    .send({ token: emailToken() })
    .expect(200);
  const count = sentEmails.length;
  await request(app)
    .post("/api/auth/request-email-verification")
    .send({ email: user.email })
    .expect(202);
  assert.equal(sentEmails.length, count);
});

test("changing a password invalidates outstanding reset links", async () => {
  const account = await recoveryUser("password-change-link");
  await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: account.user.email })
    .expect(202);
  const token = emailToken();
  await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${account.token}`)
    .send({ password: "changed via profile", currentPassword: password })
    .expect(200);
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token, password: "must not work" })
    .expect(400);
});

const { customers, leads } = await import("#model/crm.model.js");
const customerBody = {
  name: "Ada Okafor",
  email: "ada@customer.example",
  company: "Greenfield Studio",
  phone: "+234 800 000 0000",
  notes: "Met at the Lagos event",
};
const leadBody = {
  title: "Annual support contract",
  company: "Greenfield Studio",
  contactName: "Ada",
  value: 250000.5,
  source: "Referral",
  followUpDate: "2026-12-15",
};
const crmRequest = (method, path, token, body) =>
  request(app)
    [method](`/api/crm${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

test("CRM supports full customer and lead CRUD and preserves omitted patch fields", async () => {
  const account = await recoveryUser("crm-crud");
  const customer = (
    await crmRequest("post", "/customers", account.token, customerBody).expect(
      201,
    )
  ).body.record;
  assert.equal(customer.ownerId, account.user.id);
  const lead = (
    await crmRequest("post", "/leads", account.token, {
      ...leadBody,
      customerId: customer.id,
    }).expect(201)
  ).body.record;
  await crmRequest("get", `/customers/${customer.id}`, account.token).expect(
    200,
  );
  const update = await crmRequest("patch", `/leads/${lead.id}`, account.token, {
    stage: "qualified",
  }).expect(200);
  assert.equal(update.body.record.stage, "qualified");
  assert.equal(Number(update.body.record.value), leadBody.value);
  assert.equal(update.body.record.customerId, customer.id);
  assert.equal(update.body.record.followUpDate, leadBody.followUpDate);
  assert.equal(update.body.record.source, "Referral");
  const customerUpdate = await crmRequest(
    "patch",
    `/customers/${customer.id}`,
    account.token,
    { name: "Ada O." },
  ).expect(200);
  assert.equal(customerUpdate.body.record.notes, customerBody.notes);
  assert.equal(customerUpdate.body.record.company, customerBody.company);
  const overview = (
    await crmRequest("get", "/overview", account.token).expect(200)
  ).body;
  assert.equal(overview.customers, 1);
  assert.equal(overview.pipeline[0].stage, "qualified");
  assert.equal(Number(overview.pipeline[0].value), leadBody.value);
  assert.equal(overview.followUps[0].id, lead.id);
  await crmRequest("delete", `/customers/${customer.id}`, account.token).expect(
    200,
  );
  const retained = (
    await crmRequest("get", `/leads/${lead.id}`, account.token).expect(200)
  ).body.record;
  assert.equal(retained.customerId, null);
  await crmRequest("delete", `/leads/${lead.id}`, account.token).expect(200);
  await crmRequest("get", `/leads/${lead.id}`, account.token).expect(404);
});

test("CRM isolates salespeople and permits administrators to manage team records", async () => {
  const owner = await recoveryUser("crm-owner");
  const other = await recoveryUser("crm-other");
  const admin = await createTestAdmin("crm-admin@example.com");
  const customer = (
    await crmRequest("post", "/customers", owner.token, customerBody).expect(
      201,
    )
  ).body.record;
  const lead = (
    await crmRequest("post", "/leads", owner.token, leadBody).expect(201)
  ).body.record;
  for (const [resource, record] of [
    ["customers", customer],
    ["leads", lead],
  ]) {
    for (const method of ["get", "patch", "delete"]) {
      await crmRequest(
        method,
        `/${resource}/${record.id}`,
        other.token,
        method === "patch" ? { notes: "Not allowed" } : undefined,
      ).expect(404);
    }
    const list = await crmRequest("get", `/${resource}`, other.token).expect(
      200,
    );
    assert.equal(list.body.total, 0);
    await request(app)
      .patch(`/api/crm/${resource}/${record.id}`)
      .set("Authorization", admin.authorization)
      .send({ notes: "Admin note" })
      .expect(200);
  }
  const overview = (
    await crmRequest("get", "/overview", other.token).expect(200)
  ).body;
  assert.equal(overview.customers, 0);
  assert.deepEqual(overview.pipeline, []);
  await crmRequest("post", "/leads", other.token, {
    ...leadBody,
    customerId: customer.id,
  }).expect(400);
  await crmRequest("post", "/customers", other.token, {
    ...customerBody,
    ownerId: owner.user.id,
  }).expect(400);
});

test("CRM validates fields, identifiers, pagination, and empty patches", async () => {
  const account = await recoveryUser("crm-validation");
  for (const body of [
    {},
    { ...customerBody, email: "bad" },
    { ...customerBody, status: "archived" },
    { ...customerBody, notes: "a".repeat(5001) },
  ]) {
    await crmRequest("post", "/customers", account.token, body).expect(400);
  }
  for (const body of [
    {},
    { ...leadBody, value: -1 },
    { ...leadBody, value: 1.001 },
    { ...leadBody, stage: "invalid" },
    { ...leadBody, followUpDate: "2026-02-31" },
    { ...leadBody, customerId: 2147483647 },
  ]) {
    await crmRequest("post", "/leads", account.token, body).expect(400);
  }
  for (const resource of ["customers", "leads"]) {
    await crmRequest("get", `/${resource}/0`, account.token).expect(400);
    await crmRequest("patch", `/${resource}/1`, account.token, {}).expect(400);
    for (const query of [
      "page=0",
      "limit=101",
      "search=" + "a".repeat(101),
      "ownerId=1",
    ]) {
      await crmRequest("get", `/${resource}?${query}`, account.token).expect(
        400,
      );
    }
  }
});

test("CRM lists paginate, filter and search without treating wildcards as data access", async () => {
  const account = await recoveryUser("crm-search");
  await crmRequest("post", "/customers", account.token, customerBody).expect(
    201,
  );
  await crmRequest("post", "/customers", account.token, {
    ...customerBody,
    name: "Second",
    status: "inactive",
  }).expect(201);
  const first = await crmRequest(
    "get",
    "/customers?limit=1",
    account.token,
  ).expect(200);
  assert.equal(first.body.total, 2);
  assert.equal(first.body.hasMore, true);
  const second = await crmRequest(
    "get",
    "/customers?limit=1&page=2",
    account.token,
  ).expect(200);
  assert.notEqual(first.body.customers[0].id, second.body.customers[0].id);
  const filtered = await crmRequest(
    "get",
    "/customers?status=inactive&search=second",
    account.token,
  ).expect(200);
  assert.equal(filtered.body.total, 1);
  const wildcard = await crmRequest(
    "get",
    "/customers?search=%25",
    account.token,
  ).expect(200);
  assert.equal(wildcard.body.total, 0);
});

test("CRM rejects missing or revoked sessions and rate limits before database work", async () => {
  for (const path of ["/overview", "/customers", "/leads"])
    await request(app).get(`/api/crm${path}`).expect(401);
  const account = await recoveryUser("crm-session");
  await testDb
    .update(users)
    .set({ sessionVersion: 1 })
    .where(eq(users.id, account.user.id));
  await crmRequest("get", "/overview", account.token).expect(401);
  const original = publicProtection.protect;
  publicProtection.protect = async () => ({
    isDenied: () => true,
    reason: { isRateLimit: () => true },
  });
  const calls = db.select.mock.callCount();
  try {
    await crmRequest("get", "/customers", signToken(seedId)).expect(429);
    assert.equal(db.select.mock.callCount(), calls);
  } finally {
    publicProtection.protect = original;
  }
});

test("CRM retains business records when a user is deleted", async () => {
  const account = await recoveryUser("crm-deleted-owner");
  const customer = (
    await crmRequest("post", "/customers", account.token, customerBody).expect(
      201,
    )
  ).body.record;
  const lead = (
    await crmRequest("post", "/leads", account.token, leadBody).expect(201)
  ).body.record;
  await testDb.delete(users).where(eq(users.id, account.user.id));
  const [storedCustomer] = await testDb
    .select()
    .from(customers)
    .where(eq(customers.id, customer.id));
  const [storedLead] = await testDb
    .select()
    .from(leads)
    .where(eq(leads.id, lead.id));
  assert.equal(storedCustomer.ownerId, null);
  assert.equal(storedLead.ownerId, null);
});

test("CRM logs database errors without leaking record contents", async () => {
  const original = db.select;
  db.select = () => {
    throw new Error("PRIVATE customer details");
  };
  try {
    const response = await crmRequest(
      "get",
      "/customers",
      signToken(seedId),
    ).expect(500);
    assert.ok(!JSON.stringify(response.body).includes("PRIVATE"));
    assert.deepEqual(errorLog.mock.calls.at(-1).arguments, [
      "CRM operation failed",
      { operation: "customers.list", errorName: "Error" },
    ]);
  } finally {
    db.select = original;
  }
});

test("CRM frontend and assets are served from the application entry point", async () => {
  const page = await request(app).get("/").expect(200);
  assert.match(page.text, /crm-assets\/app.js/);
  await request(app).get("/crm-assets/app.js").expect(200);
  await request(app).get("/crm-assets/app.css").expect(200);
  await request(app).get("/crm-assets/layout.css").expect(200);
});
