import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isAiSettingsLiveAllowed, isAiSettingsPreviewAllowed } from "@/lib/previewGuard";

afterEach(() => vi.unstubAllEnvs());

describe("AI settings design preview boundary", () => {
  it.each([
    ["production", "production", false],
    ["development", "production", true],
    ["production", undefined, false],
    ["test", undefined, false],
    ["development", undefined, true],
    ["production", "preview", true],
  ] as const)("NODE_ENV=%s / VERCEL_ENV=%s allows preview: %s", (nodeEnv, deployment, allowed) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("VERCEL_ENV", deployment);
    expect(isAiSettingsPreviewAllowed()).toBe(allowed);
  });
});

describe("AI settings live boundary", () => {
  it.each([
    ["production", "production", true],
    ["development", "production", false],
    ["production", "preview", false],
    ["production", undefined, false],
    ["development", undefined, false],
    ["test", "production", false],
  ] as const)("NODE_ENV=%s / VERCEL_ENV=%s permits live actions: %s", (nodeEnv, deployment, allowed) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("VERCEL_ENV", deployment);
    expect(isAiSettingsLiveAllowed()).toBe(allowed);
  });
});
