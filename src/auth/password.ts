import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, key] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}