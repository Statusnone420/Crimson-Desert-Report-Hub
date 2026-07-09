import { describe, expect, it } from "vitest";
import {
  computeAutomationBudget,
  countRemainingRunsThisMonth,
  OPENROUTER_AUTOMATION_MODEL,
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

  it("allows only DeepSeek V4 Flash on the paid automation path", () => {
    expect(resolveAutomationOpenRouterModel(undefined)).toBe(OPENROUTER_AUTOMATION_MODEL);
    expect(resolveAutomationOpenRouterModel("deepseek/deepseek-v4-flash")).toBe(OPENROUTER_AUTOMATION_MODEL);
    expect(() => resolveAutomationOpenRouterModel("deepseek/deepseek-v4-pro")).toThrow(/Automation model/);
  });

  it("counts hourly runs remaining in the month by default", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T18:00:00Z"))).toBe(6);
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"))).toBe(24);
  });

  it("counts remaining runs with a custom policy interval", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"), 120)).toBe(12);
  });
});
