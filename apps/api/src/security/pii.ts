import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { env } from "../env";

const ENC_PREFIX = "enc:v1:";
const TOK_PREFIX = "tok:v1:";
const KEY = createHash("sha256").update(resolveEncryptionSecret(), "utf8").digest();
const TOKEN_KEY = createHash("sha256")
  .update(env.PII_TOKENIZATION_SECRET ?? resolveEncryptionSecret(), "utf8")
  .digest();

/**
 * Encrypt sensitive fields before persistence.
 * Output format: enc:v1:<iv>.<tag>.<ciphertext> (base64url chunks)
 */
export function encryptPII(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (input.length === 0) return "";

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(input, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/**
 * Decrypt field if it uses the current encrypted format.
 * Legacy plaintext rows are returned as-is for backward compatibility.
 */
export function decryptPII(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (input.length === 0) return "";
  if (!input.startsWith(ENC_PREFIX)) return input;

  const payload = input.slice(ENC_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted PII payload");

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const encrypted = Buffer.from(dataB64, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Generate deterministic, non-reversible token values for equality checks or
 * indexing without exposing raw PII in app-level logs or side-channel fields.
 */
export function tokenizePII(input: string | null | undefined): string | null {
  if (input == null) return null;
  const normalized = input.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  const digest = createHmac("sha256", TOKEN_KEY).update(normalized, "utf8").digest("base64url");
  return `${TOK_PREFIX}${digest}`;
}

export function tokenizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const normalized = input.replace(/[^\d+]/g, "");
  return tokenizePII(normalized);
}

export function tokenizeAddress(input: string | null | undefined): string | null {
  return tokenizePII(input);
}

function resolveEncryptionSecret(): string {
  if (env.PII_ENCRYPTION_SECRET) return env.PII_ENCRYPTION_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PII_ENCRYPTION_SECRET must be set in production");
  }
  // Test/dev fallback to keep local tooling and unit tests deterministic.
  return "dev-only-pii-encryption-secret-please-change";
}
