import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScannerScheduleSettings } from "@/components/operator/ai/ScannerScheduleSettings";
import type { AutomationControlState } from "@/lib/automation/settings";

vi.mock("@/app/admin/actions", () => ({ setScannerPolicy: vi.fn() }));

const control: AutomationControlState = {
  paused: false, minIntervalMinutes: 120, scheduledSearchCreditsPerRun: 3,
  monthlyTavilyCreditCap: 1000, monthlyLlmUsdCap: 0.25, modelPreset: "gpt_5_6_luna_flex", updatedAt: null,
};

describe("ScannerScheduleSettings", () => {
  it("offers schedule and search controls without duplicate model or AI budget fields", () => {
    const markup = renderToStaticMarkup(createElement(ScannerScheduleSettings, { control, tavilyUsage: { state: "unavailable" } }));
    expect(markup).toContain('name="cadence"');
    expect(markup).toContain('value="120" selected=""');
    expect(markup).toContain('name="scheduledSearchCreditsPerRun"');
    expect(markup).toContain('value="3" selected=""');
    expect(markup).toContain('name="monthlyTavilyCreditCap"');
    expect(markup).toContain('max="1000"');
    expect(markup).not.toMatch(/modelPreset|monthlyLlmUsdCap|Luna|Zero turns AI processing off/);
  });

  it.each([
    [{ state: "available", used: 62, pace: 531 } as const, "62 of 1000 used or held", "about 531 by month end"],
    [{ state: "available", used: 3, pace: null } as const, "3 of 1000 used or held", "Search depth is a per-scan maximum"],
    [{ state: "unavailable" } as const, "Tavily credit usage this month could not be read.", "The monthly cap stops searches at 1000"],
    [{ state: "available", used: 500, pace: 1550 } as const, "500 of 1000 used or held", "on pace to reach the cap"],
    [{ state: "available", used: 1000, pace: 3000 } as const, "1000 of 1000 used or held", "the cap is reached"],
  ])("keeps actual search usage visible after the form move: %j", (tavilyUsage, usage, note) => {
    const markup = renderToStaticMarkup(createElement(ScannerScheduleSettings, { control, tavilyUsage }));
    expect(markup).toContain(usage);
    expect(markup).toContain(note);
  });

  it("preserves paused cadence and distinguishes a zero search cap from an AI stop", () => {
    const markup = renderToStaticMarkup(createElement(ScannerScheduleSettings, {
      control: { ...control, paused: true, monthlyTavilyCreditCap: 0 }, tavilyUsage: { state: "available", used: 0, pace: 0 },
    }));
    expect(markup).toContain('value="paused" selected=""');
    expect(markup).toContain("searches are off because the cap is 0");
    expect(markup).not.toContain("on pace");
  });

  it("shows an error without editable defaults when the saved settings cannot be read", () => {
    const markup = renderToStaticMarkup(createElement(ScannerScheduleSettings, { control: null, tavilyUsage: { state: "unavailable" } }));
    expect(markup).toContain("Scanner settings could not be read");
    expect(markup).not.toContain("<form");
  });
});
