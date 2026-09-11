import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import nodemailer from "nodemailer";
import email from "../src/utils/email.js";

const names = [
  "NODE_ENV",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
];
const original = Object.fromEntries(
  names.map(name => [name, process.env[name]]),
);
afterEach(() => {
  mock.restoreAll();
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

test("SMTP delivery requires configuration instead of logging email contents", async () => {
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
  await assert.rejects(
    email.send({ to: "test@example.test", subject: "Test", text: "private" }),
    /must be configured/,
  );
});

test("production SMTP requires TLS and sends only the intended message", async () => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "test-password",
    MAIL_FROM: "Acquisitions <noreply@example.test>",
  });
  const sendMail = mock.fn(async () => ({}));
  const createTransport = mock.method(nodemailer, "createTransport", () => ({
    sendMail,
  }));
  const message = {
    to: "test@example.test",
    subject: "Reset",
    text: "Private link",
  };
  await email.send(message);
  const options = createTransport.mock.calls[0].arguments[0];
  assert.equal(options.requireTLS, true);
  assert.equal(options.secure, false);
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.deepEqual(options.auth, { user: "smtp-user", pass: "test-password" });
  assert.deepEqual(sendMail.mock.calls[0].arguments, [
    {
      from: process.env.MAIL_FROM,
      to: { address: message.to },
      subject: message.subject,
      text: message.text,
    },
  ]);
});
