import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const encoded = process.env.AI_SETTINGS_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("encryption_not_configured");
  return key;
}

export function aiEncryptionReady(): boolean {
  try { encryptionKey(); return true; } catch { return false; }
}

export function sealAiKey(value: string): string {
  if (value.length < 20 || value.length > 1024 || !/^[\x21-\x7e]+$/.test(value)) throw new Error("invalid_api_key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from("crimson-ai:openrouter:v1"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function openAiKey(value: string): string {
  try {
    const [version, iv, tag, payload, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !payload || extra) throw new Error();
    const nonce = Buffer.from(iv, "base64");
    const authTag = Buffer.from(tag, "base64");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
    cipher.setAAD(Buffer.from("crimson-ai:openrouter:v1"));
    cipher.setAuthTag(authTag);
    return Buffer.concat([cipher.update(Buffer.from(payload, "base64")), cipher.final()]).toString("utf8");
  } catch { throw new Error("credential_unavailable"); }
}
