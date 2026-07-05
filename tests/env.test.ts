import { afterEach, describe, expect, it } from "vitest";
import { automationBudgetUsd, automationSubreddits, computeFeatures, requiredEnv } from "@/lib/env";

describe("computeFeatures", () => {
  it("everything off with no keys", () => {
    expect(computeFeatures({})).toEqual({
      turnstile: false,
      reddit: false,
      ai: false,
      xSearch: false,
      webSearch: false,
      automation: false,
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

  it("turnstile requires both the public site key and secret", () => {
    expect(computeFeatures({ TURNSTILE_SECRET_KEY: "t" }).turnstile).toBe(false);
    expect(computeFeatures({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s" }).turnstile).toBe(false);
    expect(
      computeFeatures({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "t" }).turnstile,
    ).toBe(true);
  });

  it("xSearch flips on its key", () => {
    expect(computeFeatures({ XAI_API_KEY: "x" }).xSearch).toBe(true);
  });

  it("webSearch flips on Tavily and automation follows Reddit or web search", () => {
    expect(computeFeatures({ TAVILY_API_KEY: "t" })).toMatchObject({
      webSearch: true,
      automation: true,
    });
    expect(
      computeFeatures({
        REDDIT_CLIENT_ID: "a",
        REDDIT_CLIENT_SECRET: "b",
        REDDIT_USER_AGENT: "c",
      }),
    ).toMatchObject({
      reddit: true,
      automation: true,
    });
  });

  it("treats whitespace values as unset", () => {
    expect(
      computeFeatures({
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "   ",
        TURNSTILE_SECRET_KEY: "t",
        GROQ_API_KEY: " ",
      }),
    ).toEqual({ turnstile: false, reddit: false, ai: false, xSearch: false, webSearch: false, automation: false });
  });
});

describe("automation env helpers", () => {
  it("defaults monthly automation budget to 5 and clamps invalid values", () => {
    expect(automationBudgetUsd({})).toBe(5);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "-1" })).toBe(5);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "not-a-number" })).toBe(5);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "100" })).toBe(50);
  });

  it("keeps budget 0 as an explicit automation cutoff", () => {
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "0" })).toBe(0);
  });

  it("normalizes automation subreddit list", () => {
    expect(automationSubreddits({ AUTOMATION_SUBREDDITS: "r/CrimsonDesert, PCGaming, , r/Games" })).toEqual([
      "CrimsonDesert",
      "PCGaming",
      "Games",
    ]);
  });
});

describe("requiredEnv", () => {
  const original = process.env.SESSION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  });

  it("returns configured values", () => {
    process.env.SESSION_SECRET = "secret";
    expect(requiredEnv("SESSION_SECRET")).toBe("secret");
  });

  it("throws for missing or whitespace values", () => {
    delete process.env.SESSION_SECRET;
    expect(() => requiredEnv("SESSION_SECRET")).toThrow("Missing required env var: SESSION_SECRET");
    process.env.SESSION_SECRET = " ";
    expect(() => requiredEnv("SESSION_SECRET")).toThrow("Missing required env var: SESSION_SECRET");
  });
});
