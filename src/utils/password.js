import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64, options);
  return `scrypt-v1$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, hash) {
  if (!/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) {
    throw new Error("Unsupported password hash");
  }

  const [, salt, storedKey] = hash.split("$");
  const key = await deriveKey(password, salt, 64, options);
  return timingSafeEqual(key, Buffer.from(storedKey, "hex"));
}
