import { afterEach, describe, expect, it } from "vitest";
import { APPROVED_AUTOMATION_MODELS } from "@/lib/automation/budget";
import {
  applyLlmCircuitToStatuses,
  automationBudgetUsd,
  computeFeatures,
  integrationStatuses,
  platformContextConfigured,
  steamPlayerCountsEnabled,
  steamPulseEnabled,
  requiredEnv,
} from "@/lib/env";

describe("computeFeatures", () => {
  it("everything off with no keys", () => {
    expect(computeFeatures({})).toEqual({
      turnstile: false,
      ai: false,
      xSearch: false,
      webSearch: false,
      automation: false,
    });
  });

  it("exposes no Reddit feature flag for legacy credentials to switch on", () => {
    const features = computeFeatures({
      REDDIT_CLIENT_ID: "a",
      REDDIT_CLIENT_SECRET: "b",
      REDDIT_USER_AGENT: "c",
    });
    expect(Object.keys(features).some((key) => /reddit/i.test(key))).toBe(false);
  });

  it("ai requires OpenRouter with the approved automation model", () => {
    expect(computeFeatures({ GROQ_API_KEY: "g" }).ai).toBe(false);
    expect(computeFeatures({ OPENROUTER_API_KEY: "o" }).ai).toBe(true);
    expect(
      computeFeatures({ OPENROUTER_API_KEY: "o", OPENROUTER_AUTOMATION_MODEL: "deepseek/deepseek-v4-pro" }).ai,
    ).toBe(false);
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

  it("webSearch flips on Tavily and is the only source that enables automation", () => {
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
    ).toMatchObject({ automation: false });
  });

  it("treats whitespace values as unset", () => {
    expect(
      computeFeatures({
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "   ",
        TURNSTILE_SECRET_KEY: "t",
        GROQ_API_KEY: " ",
      }),
    ).toEqual({ turnstile: false, ai: false, xSearch: false, webSearch: false, automation: false });
  });
});

describe("steamPulseEnabled", () => {
  it("requires an explicit non-secret rollout switch", () => {
    expect(steamPulseEnabled({})).toBe(false);
    expect(steamPulseEnabled({ STEAM_PULSE_ENABLED: "true" })).toBe(true);
    expect(steamPulseEnabled({ STEAM_PULSE_ENABLED: " TRUE " })).toBe(true);
    expect(steamPulseEnabled({ STEAM_PULSE_ENABLED: "false" })).toBe(false);
  });
});

describe("steamPlayerCountsEnabled", () => {
  it("requires its own explicit switch, independently of reviews", () => {
    expect(steamPlayerCountsEnabled({})).toBe(false);
    expect(steamPlayerCountsEnabled({ STEAM_PULSE_ENABLED: "true" })).toBe(false);
    expect(steamPlayerCountsEnabled({ STEAM_PLAYER_COUNTS_ENABLED: " TRUE " })).toBe(true);
    expect(steamPlayerCountsEnabled({ STEAM_PLAYER_COUNTS_ENABLED: "false" })).toBe(false);
  });
});

describe("platformContextConfigured", () => {
  it("requires both server-only Twitch application credentials", () => {
    expect(platformContextConfigured({})).toBe(false);
    expect(platformContextConfigured({ TWITCH_CLIENT_ID: "client" })).toBe(false);
    expect(platformContextConfigured({ TWITCH_CLIENT_SECRET: "secret" })).toBe(false);
    expect(platformContextConfigured({ TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "secret" })).toBe(true);
    expect(platformContextConfigured({ TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "   " })).toBe(false);
  });
});

describe("integrationStatuses", () => {
  it("reports the two public scanner integrations disconnected when no env vars are set", () => {
    expect(integrationStatuses({})).toEqual([
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

  it("ignores legacy Reddit credentials while reporting supported integrations connected", () => {
    const statuses = integrationStatuses({
      REDDIT_CLIENT_ID: "a",
      REDDIT_CLIENT_SECRET: "b",
      REDDIT_USER_AGENT: "c",
      TAVILY_API_KEY: "t",
      OPENROUTER_API_KEY: "o",
    });
    expect(statuses).toEqual([
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
        detail: "Reads each candidate page for what broke and on which platform. It never decides what gets published.",
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
      detail: "Reads each candidate page for what broke and on which platform. It never decides what gets published.",
    });
  });

  it("names no model on the public card, so approving another cannot make it wrong", () => {
    const ai = integrationStatuses({ OPENROUTER_API_KEY: "o" }).find((s) => s.key === "ai_extraction");

    expect(ai?.detail).not.toMatch(/deepseek|gemini|gpt-oss/i);
  });

  it("connects for every approved automation model", () => {
    for (const model of APPROVED_AUTOMATION_MODELS) {
      const ai = integrationStatuses({ OPENROUTER_API_KEY: "o", OPENROUTER_AUTOMATION_MODEL: model }).find(
        (s) => s.key === "ai_extraction",
      );
      expect(ai).toMatchObject({ connected: true, missingEnv: [] });
    }
  });

  it("reports AI extraction disconnected when the configured automation model is not approved", () => {
    const ai = integrationStatuses({
      OPENROUTER_API_KEY: "o",
      OPENROUTER_AUTOMATION_MODEL: "deepseek/deepseek-v4-pro",
    }).find((status) => status.key === "ai_extraction");

    expect(ai).toMatchObject({
      connected: false,
      missingEnv: ["OPENROUTER_AUTOMATION_MODEL"],
      detail: "Not connected — the configured automation model is not approved.",
    });
  });
});

describe("automation env helpers", () => {
  it("defaults and caps the monthly automation dollar budget at two dollars", () => {
    expect(automationBudgetUsd({})).toBe(2);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "-1" })).toBe(0);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "not-a-number" })).toBe(0);
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "100" })).toBe(2);
  });

  it("keeps an explicit zero-dollar budget at zero", () => {
    expect(automationBudgetUsd({ AUTOMATION_BUDGET_USD_MONTHLY: "0" })).toBe(0);
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

describe("applyLlmCircuitToStatuses", () => {
  it("marks a connected AI extraction status as paused when the circuit is open", () => {
    const statuses = integrationStatuses({ OPENROUTER_API_KEY: "o", TAVILY_API_KEY: "t" });
    const adjusted = applyLlmCircuitToStatuses(statuses, true);

    const ai = adjusted.find((status) => status.key === "ai_extraction");
    expect(ai?.paused).toBe(true);
    expect(ai?.detail).toContain("cost-safety circuit");

    const web = adjusted.find((status) => status.key === "web_search");
    expect(web?.paused).toBeUndefined();
  });

  it("leaves statuses untouched when the circuit is closed", () => {
    const statuses = integrationStatuses({ OPENROUTER_API_KEY: "o", TAVILY_API_KEY: "t" });
    expect(applyLlmCircuitToStatuses(statuses, false)).toEqual(statuses);
  });

  it("does not mark an unconfigured AI extraction status as paused", () => {
    const statuses = integrationStatuses({ TAVILY_API_KEY: "t" });
    const adjusted = applyLlmCircuitToStatuses(statuses, true);
    expect(adjusted.find((status) => status.key === "ai_extraction")?.paused).toBeUndefined();
  });
});
