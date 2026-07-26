import { describe, expect, it } from "vitest";
import {
  APPROVED_AUTOMATION_MODELS,
  computeAutomationBudget,
  countRemainingRunsThisMonth,
  isOpenRouterRoutingRefusal,
  OPENROUTER_AUTOMATION_MODEL,
  OPENROUTER_AUTOMATION_PROVIDER_ROUTING,
  resolveAutomationOpenRouterModel,
} from "@/lib/automation/budget";

describe("automation budget", () => {
  it("caps the persisted LLM policy at the owner-approved two dollars", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 0,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00Z"),
      scannerPolicy: {
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 5,
      },
    });

    expect(budget.monthlyLlmUsdCap).toBe(2);
    expect(budget.remainingLlmUsd).toBe(2);
    expect(budget.maxLlmCalls).toBe(4);
    expect(budget.skipReasons).not.toContain("llm_budget_capped");
  });

  it("budget 0 still allows Tavily search but disables paid model calls", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 0,
      spentMonthToDateUsd: 0,
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.maxSearchQueries).toBe(5);
    expect(budget.maxLlmCalls).toBe(0);
    expect(budget.monthlyLlmUsdCap).toBe(0);
    expect(budget.skipReasons).toContain("llm_budget_capped");
  });

  it("default scanner policy gives scheduled runs one Tavily credit with hourly month math", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.monthlyTavilyCreditCap).toBe(1000);
    expect(budget.remainingTavilyCredits).toBe(1000);
    expect(budget.maxSearchQueries).toBe(1);
    expect(budget.maxTavilyCreditsPerRun).toBe(2);
    expect(budget.maxLlmCalls).toBe(4);
    expect(budget.estimatedRunAllowanceUsd).toBeGreaterThan(0);
  });

  it("honors the scanner policy search credits per scheduled run", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00Z"),
      scannerPolicy: {
        scheduledSearchCreditsPerRun: 3,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
      },
    });
    expect(budget.maxSearchQueries).toBe(3);
    expect(budget.maxSearchResults).toBe(15);
    expect(budget.maxLlmCalls).toBe(12);
  });

  it("reserves one Tavily credit for recon during a patch burst and honors the stored setting outside it", () => {
    const burstBudget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      patchBurstActive: true,
      now: new Date("2026-07-05T12:00:00Z"),
      scannerPolicy: {
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 1,
      },
    });
    const quietBudget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      patchBurstActive: false,
      now: new Date("2026-07-05T12:00:00Z"),
      scannerPolicy: {
        scheduledSearchCreditsPerRun: 2,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 1,
      },
    });

    expect(burstBudget.maxSearchQueries).toBe(2);
    expect(burstBudget.maxTavilyCreditsPerRun).toBe(3);
    expect(burstBudget.maxSearchResults).toBe(10);
    expect(burstBudget.maxLlmCalls).toBe(8);
    expect(quietBudget.maxSearchQueries).toBe(2);
    expect(quietBudget.maxTavilyCreditsPerRun).toBe(3);
    expect(quietBudget.maxSearchResults).toBe(10);
  });

  it("caps scheduled paid search by monthly Tavily credits instead of dollar run math", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      tavilyCreditsMonthToDate: 1000,
      mode: "scheduled",
      now: new Date("2026-07-20T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(false);
    expect(budget.maxSearchQueries).toBe(0);
    expect(budget.skipReasons).toContain("tavily_credit_cap");
  });

  it("uses the final monthly Tavily credit for search instead of reserving an unusable recon slot", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      tavilyCreditsMonthToDate: 999,
      mode: "scheduled",
      now: new Date("2026-07-20T12:00:00Z"),
    });

    expect(budget.remainingTavilyCredits).toBe(1);
    expect(budget.maxSearchQueries).toBe(1);
    expect(budget.maxTavilyCreditsPerRun).toBe(1);
  });

  it("caps configured Tavily credits to the free-tier scanner guardrail", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      mode: "scheduled",
      now: new Date("2026-07-20T12:00:00Z"),
      scannerPolicy: {
        scheduledSearchCreditsPerRun: 3,
        monthlyTavilyCreditCap: 4000,
        monthlyLlmUsdCap: 1,
      },
    });
    expect(budget.monthlyTavilyCreditCap).toBe(1000);
    expect(budget.remainingTavilyCredits).toBe(1000);
  });

  it("does not let estimated Tavily spend consume the scanner LLM cap", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 1,
      spentMonthToDateUsd: 720 * 0.008 + 0.25,
      tavilyCreditsMonthToDate: 720,
      llmSpentMonthToDateUsd: 0.25,
      mode: "scheduled",
      now: new Date("2026-07-31T12:00:00Z"),
      scannerPolicy: {
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
      },
    });

    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.maxSearchQueries).toBe(1);
    expect(budget.remainingTavilyCredits).toBe(180);
    expect(budget.remainingLlmUsd).toBe(0.75);
    expect(budget.skipReasons).not.toContain("budget_capped");
  });

  it("stops paid model calls after the two-dollar monthly cap", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      llmSpentMonthToDateUsd: 2,
      mode: "scheduled",
      now: new Date("2026-07-20T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.maxSearchQueries).toBe(1);
    expect(budget.maxLlmCalls).toBe(0);
    expect(budget.skipReasons).toContain("llm_budget_capped");
  });

  it("allows every approved automation model and nothing else", () => {
    expect(resolveAutomationOpenRouterModel(undefined)).toBe(OPENROUTER_AUTOMATION_MODEL);
    for (const model of APPROVED_AUTOMATION_MODELS) {
      expect(resolveAutomationOpenRouterModel(model)).toBe(model);
    }
    // An allowlist, not a price check: a cheap unvetted model is still refused.
    expect(() => resolveAutomationOpenRouterModel("deepseek/deepseek-v4-pro")).toThrow(/Automation model/);
    expect(() => resolveAutomationOpenRouterModel("openai/gpt-oss-20b")).toThrow(/Automation model/);
  });

  it("keeps the three approved models the only approved models", () => {
    // Adding one is a spending and privacy decision, so it should fail here
    // first rather than pass silently on the strength of the routing filters.
    expect([...APPROVED_AUTOMATION_MODELS]).toEqual([
      "deepseek/deepseek-v4-flash",
      "openai/gpt-oss-120b",
      "google/gemini-2.5-flash-lite",
    ]);
  });

  it("holds the routing ceiling above the approved models' listed prices", () => {
    // USD per million tokens. The cheapest DeepSeek V4 Flash endpoint sat at
    // 0.090/0.180 when this was set, so the ceiling leaves real headroom
    // instead of tripping on an ordinary provider price move.
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.max_price).toEqual({
      prompt: 0.2,
      completion: 0.5,
      request: 0,
      image: 0,
    });
    // Privacy filters are not negotiable when the ceiling moves.
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.zdr).toBe(true);
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.data_collection).toBe("deny");
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.require_parameters).toBe(true);
  });

  describe("routing refusals", () => {
    const refusal = {
      error: { message: "No endpoints found matching your data policy (Zero data retention)." },
    };

    it("recognises a refusal that never reached a provider", () => {
      expect(isOpenRouterRoutingRefusal(404, refusal)).toBe(true);
      expect(isOpenRouterRoutingRefusal(404, { error: { message: "No allowed providers are available." } })).toBe(true);
    });

    it("treats an upstream outage as something else entirely", () => {
      // 502 is a provider that failed mid-request; it can carry a real charge.
      expect(isOpenRouterRoutingRefusal(502, refusal)).toBe(false);
    });

    it("refuses to call it free once a generation exists", () => {
      // A generation id means a provider was reached, so the cost is real and
      // unverified rather than zero — the conservative path must still run.
      expect(isOpenRouterRoutingRefusal(404, { ...refusal, id: "gen-123" })).toBe(false);
    });

    it("does not match an unrelated 404", () => {
      expect(isOpenRouterRoutingRefusal(404, { error: { message: "Not found" } })).toBe(false);
      expect(isOpenRouterRoutingRefusal(404, {})).toBe(false);
      expect(isOpenRouterRoutingRefusal(404, null)).toBe(false);
    });
  });

  it("counts hourly runs remaining in the month by default", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T18:00:00Z"))).toBe(6);
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"))).toBe(24);
  });

  it("counts remaining runs with a custom policy interval", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"), 120)).toBe(12);
  });
});
