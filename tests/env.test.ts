import { afterEach, describe, expect, it } from "vitest";
import { automationBudgetUsd, automationSubreddits, computeFeatures, integrationStatuses, requiredEnv } from "@/lib/env";

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

describe("integrationStatuses", () => {
  it("reports all three integrations disconnected when no env vars are set", () => {
    expect(integrationStatuses({})).toEqual([
      {
        key: "reddit",
        label: "Reddit API",
        connected: false,
        missingEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT"],
        detail: "Not connected — the scanner reads no Reddit posts and relies on web search only.",
      },
      {
        key: "web_search",
        label: "Web search (Tavily)",
        connected: false,
        missingEnv: ["TAVILY_API_KEY"],
        detail: "Not connected — the scanner cannot discover new public sources.",
      },
      {
        key: "ai_extraction",
        label: "AI extraction (OpenRouter)",
        connected: false,
        missingEnv: ["OPENROUTER_API_KEY"],
        detail: "Not connected — falling back to deterministic keyword extraction.",
      },
    ]);
  });

  it("reddit partially configured stays disconnected and lists only the missing vars", () => {
    const statuses = integrationStatuses({ REDDIT_CLIENT_ID: "a" });
    const reddit = statuses.find((s) => s.key === "reddit");
    expect(reddit).toMatchObject({
      connected: false,
      missingEnv: ["REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT"],
      detail: "Not connected — the scanner reads no Reddit posts and relies on web search only.",
    });
  });

  it("reports all three integrations connected when all env vars are present", () => {
    const statuses = integrationStatuses({
      REDDIT_CLIENT_ID: "a",
      REDDIT_CLIENT_SECRET: "b",
      REDDIT_USER_AGENT: "c",
      TAVILY_API_KEY: "t",
      OPENROUTER_API_KEY: "o",
    });
    expect(statuses).toEqual([
      {
        key: "reddit",
        label: "Reddit API",
        connected: true,
        missingEnv: [],
        detail: "Reading r/CrimsonDesert posts each run.",
      },
      {
        key: "web_search",
        label: "Web search (Tavily)",
        connected: true,
        missingEnv: [],
        detail: "Discovering public sources via Tavily.",
      },
      {
        key: "ai_extraction",
        label: "AI extraction (OpenRouter)",
        connected: true,
        missingEnv: [],
        detail: "Extracting signals with a free model.",
      },
    ]);
  });

  it("ai extraction stays disconnected with only GROQ_API_KEY set because the scanner extractor reads OpenRouter only", () => {
    const statuses = integrationStatuses({ GROQ_API_KEY: "g" });
    const ai = statuses.find((s) => s.key === "ai_extraction");
    expect(ai).toMatchObject({
      connected: false,
      missingEnv: ["OPENROUTER_API_KEY"],
      detail: "Not connected — falling back to deterministic keyword extraction.",
    });
  });

  it("ai extraction connects with OPENROUTER_API_KEY set and reports no missing vars", () => {
    const statuses = integrationStatuses({ OPENROUTER_API_KEY: "o" });
    const ai = statuses.find((s) => s.key === "ai_extraction");
    expect(ai).toMatchObject({
      connected: true,
      missingEnv: [],
      detail: "Extracting signals with a free model.",
    });
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
    process.env.SESSION_SECRET = "\"\"";
    expect(() => requiredEnv("SESSION_SECRET")).toThrow("Missing required env var: SESSION_SECRET");
  });
});
