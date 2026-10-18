import { describe, expect, it } from "vitest";
import { columnMonthlyCapUsd, columnRequestCapUsd, ledgerMonth } from "@/lib/editorials/budget";
import { DEFAULT_COLUMN_SETTINGS, EXPANSION_LAUNCH_BURST, normalizeColumnSettings } from "@/lib/editorials/settings";

describe("column settings", () => {
  it("uses the documented defaults when the key is missing", () => {
    expect(normalizeColumnSettings(undefined)).toEqual(DEFAULT_COLUMN_SETTINGS);
    expect(DEFAULT_COLUMN_SETTINGS).toMatchObject({
      paused: false, mode: "weekly", days: ["mon"], hourUtc: 14, holdHours: 24, relevance: "normal", minGapHours: 20,
      defaultWriterModel: "claude-opus-5-5", nextEditionModel: null, monthlyCapUsd: null, provider: "anthropic", approveFirstRemaining: 3,
    });
  });

  it("seeds one disabled expansion burst", () => {
    expect(DEFAULT_COLUMN_SETTINGS.bursts).toEqual([EXPANSION_LAUNCH_BURST]);
    expect(EXPANSION_LAUNCH_BURST).toMatchObject({ enabled: false, startDate: "2026-10-29", endDate: "2026-11-04", cadence: "daily", hourUtc: 14, model: "claude-opus-5-5", holdHours: 8, relevance: "always" });
  });

  it("replaces one invalid field without resetting the others", () => {
    const settings = normalizeColumnSettings({ hourUtc: 31, holdHours: 12, relevance: "sometimes", minGapHours: 6 });
    expect(settings.hourUtc).toBe(14);
    expect(settings.holdHours).toBe(12);
    expect(settings.relevance).toBe("normal");
    expect(settings.minGapHours).toBe(6);
  });

  it("fails safe as paused when the pause value is unreadable", () => {
    expect(normalizeColumnSettings({ paused: true }).paused).toBe(true);
    expect(normalizeColumnSettings({ paused: "false" }).paused).toBe(false);
    expect(normalizeColumnSettings({ paused: "yes" }).paused).toBe(true);
    expect(normalizeColumnSettings({}).paused).toBe(false);
  });

  it("keeps the days that match the cadence, or the cadence's default days", () => {
    expect(normalizeColumnSettings({ mode: "2x", days: ["thu", "tue"] }).days).toEqual(["tue", "thu"]);
    expect(normalizeColumnSettings({ mode: "2x", days: ["mon"] }).days).toEqual(["mon", "thu"]);
    expect(normalizeColumnSettings({ mode: "3x" }).days).toEqual(["mon", "wed", "fri"]);
    expect(normalizeColumnSettings({ mode: "weekly", days: ["fri", "fri"] }).days).toEqual(["fri"]);
  });

  it("keeps an unknown model name so the precedence check can refuse it", () => {
    const settings = normalizeColumnSettings({ defaultWriterModel: "some-other-model", nextEditionModel: "claude-sonnet-5-5" });
    expect(settings.defaultWriterModel).toBe("some-other-model");
    expect(settings.nextEditionModel).toBe("claude-sonnet-5-5");
  });

  it("drops invalid or duplicate bursts and keeps the valid ones", () => {
    const valid = { ...EXPANSION_LAUNCH_BURST, id: "launch", enabled: true };
    const settings = normalizeColumnSettings({
      bursts: [valid, { ...valid }, { ...valid, id: "backwards", startDate: "2026-11-05" }, { ...valid, id: "bad-date", endDate: "2026-02-30" }, "nonsense"],
    });
    expect(settings.bursts).toEqual([valid]);
    expect(normalizeColumnSettings({ bursts: [] }).bursts).toEqual([]);
  });

  it("caps the approve-first count and the monthly cap", () => {
    expect(normalizeColumnSettings({ approveFirstRemaining: 0 }).approveFirstRemaining).toBe(0);
    expect(normalizeColumnSettings({ approveFirstRemaining: 9 }).approveFirstRemaining).toBe(3);
    expect(normalizeColumnSettings({ monthlyCapUsd: 80 }).monthlyCapUsd).toBeNull();
    expect(normalizeColumnSettings({ monthlyCapUsd: 20 }).monthlyCapUsd).toBe(20);
  });
});

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("column budget limits", () => {
  it("takes the operator's cap first, then the environment, then $15, never above $50", () => {
    expect(columnMonthlyCapUsd(null, env({}))).toBe(15);
    expect(columnMonthlyCapUsd(null, env({ COLUMN_BUDGET_USD_MONTHLY: "30" }))).toBe(30);
    expect(columnMonthlyCapUsd(null, env({ COLUMN_BUDGET_USD_MONTHLY: "90" }))).toBe(50);
    expect(columnMonthlyCapUsd(8, env({ COLUMN_BUDGET_USD_MONTHLY: "30" }))).toBe(8);
    expect(columnMonthlyCapUsd(null, env({ COLUMN_BUDGET_USD_MONTHLY: "lots" }))).toBe(15);
  });

  it("defaults the per-request cap to $1", () => {
    expect(columnRequestCapUsd(env({}))).toBe(1);
    expect(columnRequestCapUsd(env({ COLUMN_REQUEST_CAP_USD: "0.5" }))).toBe(0.5);
    expect(columnRequestCapUsd(env({ COLUMN_REQUEST_CAP_USD: "-1" }))).toBe(1);
  });

  it("keys the ledger by UTC month", () => {
    expect(ledgerMonth(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(ledgerMonth(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
