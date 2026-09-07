import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_AUTOMATION_MODELS,
  AUTOMATION_TASK_SETTINGS,
  automationModelSettings,
  computeAutomationBudget,
  countRemainingRunsThisMonth,
  evaluateOpenRouterKeyBudget,
  isOpenRouterRoutingRefusal,
  maxOpenRouterRequestCostUsd,
  OPENROUTER_AUTOMATION_MODEL,
  OPENROUTER_DEEPSEEK_ROLLBACK_MODEL,
  OPENROUTER_AUTOMATION_PROVIDER_ROUTING,
  readOpenRouterKeyBudget,
  resolveAutomationOpenRouterModel,
  SCANNER_MODEL_PRESETS,
  type OpenRouterKeyBudget,
} from "@/lib/automation/budget";

describe("automation budget", () => {
  it("caps the persisted LLM policy at the owner-approved dollar", () => {
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

    expect(budget.monthlyLlmUsdCap).toBe(1);
    expect(budget.remainingLlmUsd).toBe(1);
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
    expect(budget.monthlyLlmUsdCap).toBe(0.5);
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

  it("stops paid model calls after the one-dollar monthly cap", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      llmSpentMonthToDateUsd: 1,
      scannerPolicy: { monthlyLlmUsdCap: 1 },
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
    expect(automationModelSettings(OPENROUTER_AUTOMATION_MODEL).outputTokenParameter).toBe("max_tokens");
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.max_price).toEqual({
      prompt: 0.2,
      completion: 1.2,
      request: 0,
      image: 0,
    });
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.only).toEqual(["OpenAI"]);
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.allow_fallbacks).toBe(false);
    expect("zdr" in OPENROUTER_AUTOMATION_PROVIDER_ROUTING).toBe(false);
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.data_collection).toBe("allow");
    expect(OPENROUTER_AUTOMATION_PROVIDER_ROUTING.require_parameters).toBe(true);
  });

  it("retains ZDR for the explicit DeepSeek rollback route", () => {
    expect(automationModelSettings(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL).outputTokenParameter).toBe("max_tokens");
    expect(automationModelSettings(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL).provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
      sort: "price",
      max_price: { prompt: 0.2, completion: 0.5, request: 0, image: 0 },
    });
  });

  it("keeps Flex explicit and resolves saved presets before environment routing", () => {
    expect(SCANNER_MODEL_PRESETS.map(({ id }) => id)).toEqual([
      "gpt_5_6_luna", "gpt_5_6_luna_flex", "deepseek_v4_flash_rollback",
    ]);
    expect(resolveAutomationOpenRouterModel(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL, "gpt_5_6_luna_flex"))
      .toBe(OPENROUTER_AUTOMATION_MODEL);
    expect(resolveAutomationOpenRouterModel(OPENROUTER_AUTOMATION_MODEL, "deepseek_v4_flash_rollback"))
      .toBe(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL);
    const flex = automationModelSettings(OPENROUTER_AUTOMATION_MODEL, "gpt_5_6_luna_flex");
    expect(flex).toMatchObject({
      serviceTier: "flex",
      provider: {
        only: ["OpenAI"], allow_fallbacks: false, data_collection: "allow", require_parameters: true,
        max_price: { prompt: 0.1, completion: 0.6, request: 0, image: 0 },
      },
    });
    expect(automationModelSettings(OPENROUTER_AUTOMATION_MODEL)).not.toHaveProperty("serviceTier");
    expect(() => automationModelSettings(OPENROUTER_DEEPSEEK_ROLLBACK_MODEL, "gpt_5_6_luna_flex"))
      .toThrow(/do not match/);
    const standard = maxOpenRouterRequestCostUsd("same prompt", 3_200);
    const flexCost = maxOpenRouterRequestCostUsd("same prompt", 3_200, OPENROUTER_AUTOMATION_MODEL, "gpt_5_6_luna_flex");
    expect(flexCost).toBeCloseTo(standard / 2);
  });

  it("reserves full high-reasoning completion allowances at each model's price ceiling", () => {
    expect(AUTOMATION_TASK_SETTINGS).toEqual({
      extraction: { maxCompletionTokens: 3_200 },
      claim_mapping: { maxCompletionTokens: 2_048 },
    });
    expect(maxOpenRouterRequestCostUsd("", AUTOMATION_TASK_SETTINGS.extraction.maxCompletionTokens)).toBeCloseTo(0.00384);
    expect(
      maxOpenRouterRequestCostUsd(
        "",
        AUTOMATION_TASK_SETTINGS.claim_mapping.maxCompletionTokens,
        OPENROUTER_DEEPSEEK_ROLLBACK_MODEL,
      ),
    ).toBeCloseTo(0.001024);
  });

  describe("OpenRouter key budget", () => {
    const safeKey: OpenRouterKeyBudget = {
      limitUsd: 1,
      limitRemainingUsd: 0.75,
      limitReset: "monthly",
      usageMonthlyUsd: 0.25,
    };
    const localBudget = { monthlyLlmUsdCap: 0.5, remainingLlmUsd: 0.4 };

    it("uses the smallest local, aggregate monthly, and key allowance", () => {
      expect(evaluateOpenRouterKeyBudget(safeKey, localBudget)).toEqual({ remainingLlmUsd: 0.25, skipReason: null });
      expect(evaluateOpenRouterKeyBudget({ ...safeKey, limitRemainingUsd: 0.1 }, localBudget))
        .toEqual({ remainingLlmUsd: 0.1, skipReason: null });
      expect(evaluateOpenRouterKeyBudget(safeKey, { ...localBudget, remainingLlmUsd: 0.04 }))
        .toEqual({ remainingLlmUsd: 0.04, skipReason: null });
      expect(evaluateOpenRouterKeyBudget({ ...safeKey, limitReset: null, limitRemainingUsd: 0.05 }, localBudget))
        .toEqual({ remainingLlmUsd: 0.05, skipReason: null });
    });

    it.each([
      { ...safeKey, limitUsd: null, limitRemainingUsd: null },
      { ...safeKey, limitUsd: 2 },
      { ...safeKey, limitReset: "daily" as const },
      { ...safeKey, limitReset: "weekly" as const },
    ])("rejects a key without the required aggregate ceiling: %j", (snapshot) => {
      expect(evaluateOpenRouterKeyBudget(snapshot, localBudget))
        .toEqual({ remainingLlmUsd: 0, skipReason: "openrouter_key_limit_unsafe" });
    });

    it.each([
      null,
      { ...safeKey, limitRemainingUsd: null },
      { ...safeKey, limitRemainingUsd: Number.POSITIVE_INFINITY },
      { ...safeKey, usageMonthlyUsd: Number.NaN },
      { ...safeKey, usageMonthlyUsd: -1 },
      { ...safeKey, limitUsd: Number.NaN },
      { ...safeKey, limitRemainingUsd: 1.1 },
    ])("fails closed for unreadable or inconsistent key counters: %j", (snapshot) => {
      expect(evaluateOpenRouterKeyBudget(snapshot, localBudget))
        .toEqual({ remainingLlmUsd: 0, skipReason: "openrouter_key_budget_unverified" });
    });

    it("stops when any valid spending allowance is exhausted", () => {
      for (const snapshot of [
        { ...safeKey, limitRemainingUsd: 0 },
        { ...safeKey, usageMonthlyUsd: 0.5 },
        { ...safeKey, limitUsd: 0, limitRemainingUsd: 0 },
      ]) {
        expect(evaluateOpenRouterKeyBudget(snapshot, localBudget))
          .toEqual({ remainingLlmUsd: 0, skipReason: "llm_budget_capped" });
      }
      expect(evaluateOpenRouterKeyBudget(safeKey, { ...localBudget, remainingLlmUsd: 0 }))
        .toEqual({ remainingLlmUsd: 0, skipReason: "llm_budget_capped" });
      expect(evaluateOpenRouterKeyBudget(safeKey, { ...localBudget, remainingLlmUsd: Number.NaN }))
        .toEqual({ remainingLlmUsd: 0, skipReason: "openrouter_key_budget_unverified" });
    });

    it("bounds a fetch that ignores cancellation to two seconds", async () => {
      vi.useFakeTimers();
      try {
        let signal: AbortSignal | undefined;
        const reading = readOpenRouterKeyBudget("test-key", async (_url, init) => {
          signal = init.signal;
          return new Promise(() => {});
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await expect(reading).resolves.toBeNull();
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("also bounds a stalled JSON body", async () => {
      vi.useFakeTimers();
      try {
        const reading = readOpenRouterKeyBudget("test-key", async () => ({
          ok: true, status: 200, json: () => new Promise(() => {}),
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await expect(reading).resolves.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads the provider-enforced monthly limit and actual key usage", async () => {
      const budget = await readOpenRouterKeyBudget("test-key", async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            limit: 2,
            limit_remaining: 1.75,
            limit_reset: "monthly",
            usage_monthly: 0.25,
          },
        }),
      }));

      expect(budget).toEqual({
        limitUsd: 2,
        limitRemainingUsd: 1.75,
        limitReset: "monthly",
        usageMonthlyUsd: 0.25,
      });
    });

    it("fails closed when OpenRouter does not return a usable key budget", async () => {
      await expect(
        readOpenRouterKeyBudget("test-key", async () => ({ ok: false, status: 503, json: async () => ({}) })),
      ).resolves.toBeNull();
      await expect(
        readOpenRouterKeyBudget("test-key", async () => ({
          ok: true,
          status: 200,
          json: async () => ({ data: { limit: "unknown" } }),
        })),
      ).resolves.toBeNull();
    });
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
