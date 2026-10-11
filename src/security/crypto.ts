import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const VERSION = "v1";

export class EncryptionKeyError extends Error {
  statusCode = 500;
  constructor() {
    super("APP_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -base64 32` and add it to the server environment.");
  }
}

function parseKey(raw: string | undefined) {
  if (!raw) return null;
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

let keyOverride: Buffer | null | undefined;

/** Tests only: use a fixed key instead of the environment. */
export function setEncryptionKeyForTests(key: Buffer | null | undefined) {
  keyOverride = key;
}

function getKey() {
  const key = keyOverride !== undefined ? keyOverride : parseKey(env.APP_ENCRYPTION_KEY);
  if (!key) throw new EncryptionKeyError();
  return key;
}

export function isEncryptionConfigured() {
  try { getKey(); return true; } catch { return false; }
}

/** AES-256-GCM; output is `v1:<base64(iv | tag | ciphertext)>`. */
export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [version, body] = payload.split(":");
  if (version !== VERSION || !body) throw new Error("Unsupported encrypted value format");
  const raw = Buffer.from(body, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Shows only enough of a secret for the admin to recognise it, e.g. `sk-…9f2A`. */
export function maskSecret(secret: string) {
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}
