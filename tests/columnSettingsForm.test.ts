import { beforeEach, describe, expect, it, vi } from "vitest";
import { burstFromForm, cadenceFromForm } from "@/lib/editorials/settingsForm";

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const item of [value].flat()) data.append(key, item);
  return data;
}

const cadence = { mode: "2x", days: ["mon", "thu"], hourUtc: "14", holdHours: "24", relevance: "normal", minGapHours: "20", defaultWriterModel: "", nextEditionModel: "claude-fable-5-1", monthlyCapUsd: "", provider: "openrouter" };

describe("the cadence form", () => {
  it("reads every dial, with blank models and cap meaning not set", () => {
    expect(cadenceFromForm(form(cadence))).toEqual({ ok: true, value: {
      mode: "2x", days: ["mon", "thu"], hourUtc: 14, holdHours: 24, relevance: "normal", minGapHours: 20, provider: "openrouter",
      defaultWriterModel: null, nextEditionModel: "claude-fable-5-1", monthlyCapUsd: null,
    } });
  });

  it("refuses days that don't match the cadence", () => {
    expect(cadenceFromForm(form({ ...cadence, days: ["mon"] }))).toEqual({ ok: false, error: "days_mismatch" });
  });

  it("leaves out a kept provider or model, so the stored value stays and keeps skipping", () => {
    expect(cadenceFromForm(form({ ...cadence, provider: "keep", defaultWriterModel: "keep", nextEditionModel: "keep" }))).toEqual({ ok: true, value: {
      mode: "2x", days: ["mon", "thu"], hourUtc: 14, holdHours: 24, relevance: "normal", minGapHours: 20, monthlyCapUsd: null,
    } });
  });

  it.each([
    ["an hour past 23", { hourUtc: "24" }],
    ["a cap over $50", { monthlyCapUsd: "60" }],
    ["a model off the allowlist", { nextEditionModel: "claude-haiku-5-5" }],
    ["an unknown provider", { provider: "elsewhere" }],
    ["a negative hold", { holdHours: "-1" }],
  ])("refuses %s", (_label, patch) => {
    expect(cadenceFromForm(form({ ...cadence, ...patch }))).toEqual({ ok: false, error: "invalid_value" });
  });
});

describe("the burst form", () => {
  const burst = { label: "Expansion launch", model: "claude-opus-5-5", startDate: "2026-10-29", endDate: "2026-11-04", hourUtc: "14", holdHours: "8", relevance: "always", enabled: "on" };

  beforeEach(() => vi.spyOn(crypto, "randomUUID").mockReturnValue("abcdef12-0000-4000-8000-000000000000"));

  it("gives a new burst an id and keeps an edited burst's own", () => {
    expect(burstFromForm(form(burst))).toEqual({ ok: true, value: { id: "expansion-launch-abcdef", label: "Expansion launch", enabled: true, startDate: "2026-10-29", endDate: "2026-11-04", cadence: "daily", hourUtc: 14, model: "claude-opus-5-5", holdHours: 8, relevance: "always" } });
    const edited = burstFromForm(form({ ...burst, id: "expansion-launch", enabled: "", relevance: "" }));
    expect(edited).toMatchObject({ ok: true, value: { id: "expansion-launch", enabled: false } });
    expect(edited.ok && "relevance" in edited.value).toBe(false);
  });

  it("refuses a burst that ends before it starts or names an off-list model", () => {
    expect(burstFromForm(form({ ...burst, endDate: "2026-10-28" }))).toEqual({ ok: false, error: "invalid_value" });
    expect(burstFromForm(form({ ...burst, model: "gpt-5" }))).toEqual({ ok: false, error: "invalid_value" });
  });

  it("keeps an edited burst's stored model, even one off the allowlist, and only for a burst that exists", () => {
    const stored = [{ id: "expansion-launch", label: "Expansion launch", enabled: true, startDate: "2026-10-29", endDate: "2026-11-04", cadence: "daily" as const, hourUtc: 14, model: "gpt-5", holdHours: 8 }];
    expect(burstFromForm(form({ ...burst, id: "expansion-launch", model: "keep" }), stored)).toMatchObject({ ok: true, value: { id: "expansion-launch", model: "gpt-5" } });
    expect(burstFromForm(form({ ...burst, model: "keep" }), stored)).toEqual({ ok: false, error: "invalid_value" });
  });
});
