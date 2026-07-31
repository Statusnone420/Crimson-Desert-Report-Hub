import { describe, expect, it } from "vitest";
import {
  APPROVED_AUTOMATION_MODELS,
  AUTOMATION_TASK_SETTINGS,
  automationModelSettings,
  computeAutomationBudget,
  countRemainingRunsThisMonth,
  isOpenRouterRoutingRefusal,
  maxOpenRouterRequestCostUsd,
  OPENROUTER_AUTOMATION_MODEL,
  OPENROUTER_DEEPSEEK_ROLLBACK_MODEL,
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

  it("keeps Luna and the explicit DeepSeek rollback as the only approved paid models", () => {
    // Adding one is a spending and privacy decision, so it should fail here
    // first rather than pass silently on the strength of the routing filters.
    expect([...APPROVED_AUTOMATION_MODELS]).toEqual([
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-flash",
    ]);
  });

  it("pins Luna to first-party OpenAI with no provider fallback or request ZDR", () => {
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.max_price).toEqual({
      prompt: 0.15,
      completion: 0.9,
      request: 0,
      image: 0,
    });
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.only).toEqual(["openai"]);
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.allow_fallbacks).toBe(false);
    expect("zdr" in OPENROUTER_AUTOMATION_PROVIDER_ROUTING).toBe(false);
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.data_collection).toBe("deny");
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.require_parameters).toBe(true);
  });

  it("retains ZDR for the explicit DeepSeek rollback route", () => {
    expect(automationModelSettings(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL).provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
      sort: "price",
      max_price: { prompt: 0.2, completion: 0.5, request: 0, image: 0 },
    });
  });

  it("reserves full high-reasoning completion allowances at each model's price ceiling", () => {
    expect(AUTOMATION_TASK_SETTINGS).toEqual({
      extraction: { maxCompletionTokens: 3_200 },
      claim_mapping: { maxCompletionTokens: 2_048 },
    });
    expect(maxOpenRouterRequestCostUsd("", AUTOMATION_TASK_SETTINGS.extraction.maxCompletionTokens)).toBeCloseTo(0.00288);
    expect(
      maxOpenRouterRequestCostUsd(
        "",
        AUTOMATION_TASK_SETTINGS.claim_mapping.maxCompletionTokens,
        OPENROUTER_DEEPSEEK_ROLLBACK_MODEL,
      ),
    ).toBeCloseTo(0.001024);
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
