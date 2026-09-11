import nodemailer from "nodemailer";

// Object export permits isolated tests to replace delivery without using real SMTP.
export default {
  async send({ to, subject, text }) {
    if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) {
      throw new Error("SMTP_HOST and MAIL_FROM must be configured");
    }
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.NODE_ENV === "production",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: { address: to },
      subject,
      text,
    });
  },
};
