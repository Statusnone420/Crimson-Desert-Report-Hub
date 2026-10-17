import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiEncryptionReady, openAiKey, sealAiKey } from "@/lib/aiSettings/credentials.server";

const fixtureKey = "fixture-provider-credential-not-a-real-secret";
beforeEach(() => { vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("AI credential encryption", () => {
  it("round trips with fresh nonces and stores neither plaintext nor its base64 form", () => {
    const first = sealAiKey(fixtureKey);
    const second = sealAiKey(fixtureKey);
    expect(aiEncryptionReady()).toBe(true);
    expect(first).not.toBe(second);
    for (const sealed of [first, second]) {
      expect(openAiKey(sealed)).toBe(fixtureKey);
      expect(sealed).not.toContain(fixtureKey);
      expect(sealed).not.toContain(Buffer.from(fixtureKey).toString("base64"));
    }
  });

  it.each([1, 2, 3])("rejects tampering with encrypted envelope field %i", (field) => {
    const parts = sealAiKey(fixtureKey).split(".");
    const bytes = Buffer.from(parts[field], "base64");
    bytes[0] ^= 1;
    parts[field] = bytes.toString("base64");
    expect(() => openAiKey(parts.join("."))).toThrow("credential_unavailable");
  });

  it("fails closed after encryption-key replacement without exposing the stored payload", () => {
    const sealed = sealAiKey(fixtureKey);
    vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(() => openAiKey(sealed)).toThrow(/^credential_unavailable$/);
    expect(() => openAiKey(`${sealed}.extra`)).toThrow(/^credential_unavailable$/);
  });

  it.each(["", "not-base64", Buffer.alloc(31).toString("base64"), `${Buffer.alloc(32).toString("base64")}\n`])(
    "requires a canonical 32-byte encryption key", (key) => {
      vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", key);
      expect(aiEncryptionReady()).toBe(false);
      expect(() => sealAiKey(fixtureKey)).toThrow(/^encryption_not_configured$/);
    });

  it.each(["short", `${fixtureKey}\n`, "x".repeat(1025)])("rejects invalid provider credentials before storage", (key) => {
    expect(() => sealAiKey(key)).toThrow(/^invalid_api_key$/);
  });
});
