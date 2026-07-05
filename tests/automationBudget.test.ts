import { describe, expect, it } from "vitest";
import {
  computeAutomationBudget,
  countRemainingRunsThisMonth,
  rejectPaidOpenRouterModel,
} from "@/lib/automation/budget";

describe("automation budget", () => {
  it("budget 0 disables paid search and llm calls", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 0,
      spentMonthToDateUsd: 0,
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(false);
    expect(budget.maxSearchQueries).toBe(0);
    expect(budget.maxLlmCalls).toBe(0);
    expect(budget.skipReasons).toContain("budget_zero");
  });

  it("budget 5 derives bounded per-run caps", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.maxSearchQueries).toBeGreaterThan(0);
    expect(budget.maxSearchQueries).toBeLessThanOrEqual(5);
    expect(budget.maxLlmCalls).toBeLessThanOrEqual(20);
    expect(budget.estimatedRunAllowanceUsd).toBeGreaterThan(0);
  });

  it("exhausted budget skips paid work", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 5.01,
      now: new Date("2026-07-20T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(false);
    expect(budget.maxSearchQueries).toBe(0);
    expect(budget.skipReasons).toContain("budget_capped");
  });

  it("counts 6-hour runs remaining in the month", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T18:00:00Z"))).toBe(1);
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"))).toBe(4);
  });

  it("rejects non-free OpenRouter model IDs while allowing the free router", () => {
    expect(() => rejectPaidOpenRouterModel("openai/gpt-4.1")).toThrow(/openrouter\/free/);
    expect(rejectPaidOpenRouterModel("openrouter/free")).toBe("openrouter/free");
    expect(rejectPaidOpenRouterModel("meta-llama/llama-3.3-70b-instruct:free")).toBe(
      "meta-llama/llama-3.3-70b-instruct:free",
    );
  });
});
