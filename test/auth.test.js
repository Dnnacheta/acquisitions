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
const { verifyToken, signToken } = await import("#utils/jwt.js");
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
