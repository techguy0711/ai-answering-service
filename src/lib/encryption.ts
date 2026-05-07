// AES-256-GCM helpers for at-rest encryption of per-tenant secrets
// (Google refresh tokens, etc.). Key comes from TENANT_SECRETS_KEY env var,
// 32 bytes base64-encoded.
//
// Format: <iv_b64>:<ciphertext_b64>:<tag_b64>
//
// This is the simplest-thing-that-works choice. If you want a real KMS later
// (AWS KMS, GCP KMS, Doppler/Infisical), swap the implementation here and
// keep the call sites the same.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const b64 = process.env.TENANT_SECRETS_KEY;
  if (!b64) {
    throw new Error("TENANT_SECRETS_KEY is not set");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TENANT_SECRETS_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

export function decryptSecret(envelope: string): string {
  const [ivB64, ctB64, tagB64] = envelope.split(":");
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error("Malformed encrypted envelope");
  }
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
