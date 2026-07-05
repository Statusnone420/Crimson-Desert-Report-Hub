import { describe, expect, it } from "vitest";
import { computeFeatures } from "@/lib/env";

describe("computeFeatures", () => {
  it("everything off with no keys", () => {
    expect(computeFeatures({})).toEqual({
      turnstile: false,
      reddit: false,
      ai: false,
      xSearch: false,
    });
  });

  it("reddit requires all three reddit vars", () => {
    expect(computeFeatures({ REDDIT_CLIENT_ID: "a", REDDIT_CLIENT_SECRET: "b" }).reddit).toBe(false);
    expect(
      computeFeatures({
        REDDIT_CLIENT_ID: "a",
        REDDIT_CLIENT_SECRET: "b",
        REDDIT_USER_AGENT: "c",
      }).reddit,
    ).toBe(true);
  });

  it("ai on with either groq or openrouter", () => {
    expect(computeFeatures({ GROQ_API_KEY: "g" }).ai).toBe(true);
    expect(computeFeatures({ OPENROUTER_API_KEY: "o" }).ai).toBe(true);
  });

  it("turnstile and xSearch flip on their keys", () => {
    expect(computeFeatures({ TURNSTILE_SECRET_KEY: "t" }).turnstile).toBe(true);
    expect(computeFeatures({ XAI_API_KEY: "x" }).xSearch).toBe(true);
  });
});
