import { config } from "dotenv";
import jwt from "jsonwebtoken";
import logger from "#config/logger.js";

config({ path: [".env.local", ".env"], quiet: true });

const secret = process.env.JWT_SECRET;
if (!secret || Buffer.byteLength(secret) < 32) {
  logger.error(
    "JWT configuration failed: JWT_SECRET must contain at least 32 bytes",
  );
  throw new Error("JWT_SECRET must contain at least 32 bytes");
}

const issuer = "acquisitions";
const audience = "acquisitions-api";

export function signToken(userId, sessionVersion = 0) {
  try {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new TypeError("A positive integer user ID is required");
    }

    return jwt.sign({ sessionVersion }, secret, {
      algorithm: "HS256",
      subject: String(userId),
      issuer,
      audience,
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    });
  } catch (error) {
    logger.error("JWT signing failed", { errorName: error.name });
    throw error;
  }
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    });

    if (
      typeof payload !== "object" ||
      !/^[1-9]\d*$/.test(payload.sub) ||
      !Number.isSafeInteger(Number(payload.sub)) ||
      !Number.isFinite(payload.exp)
    ) {
      throw new jwt.JsonWebTokenError("Invalid token claims");
    }

    return payload;
  } catch (error) {
    logger.error("JWT verification failed", { errorName: error.name });
    throw error;
  }
}
