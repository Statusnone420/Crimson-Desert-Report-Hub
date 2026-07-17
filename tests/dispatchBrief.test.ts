import { describe, expect, it } from "vitest";
import {
  composeDispatchBrief,
  formatWeeklyDelta,
  patchDayNumber,
  patchTypeLabel,
  weeklyDeltaSentence,
  weeklyReportWindows,
} from "@/lib/dispatchBrief";
import type { DailySignalDay } from "@/lib/queries";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function days(reports: number[]): DailySignalDay[] {
  return reports.map((count, index) => ({
    day: `2026-07-${String(8 + index).padStart(2, "0")}`,
    reports: count,
    taps: count,
    keptLeads: 0,
  }));
}

const base = {
  patchVersion: "1.13.01",
  publishedAt: "2026-07-08T05:51:00.000Z",
  reports: 12,
  taps: 6,
  keptLeadsThisWeek: 2,
  contested: null,
  claimedFixCount: 2,
  contestedClaimCount: 0,
  series: days([5, 4, 3, 2, 1, 1, 1, 1, 0, 1]),
  now: NOW,
};

describe("dispatch brief composer", () => {
  it("labels hotfix versions and counts patch days", () => {
    expect(patchTypeLabel("1.13.01")).toBe("HOTFIX");
    expect(patchTypeLabel("1.14.0")).toBe("UPDATE");
    expect(patchTypeLabel("1.14")).toBe("UPDATE");
    expect(patchDayNumber("2026-07-08T05:51:00.000Z", NOW)).toBe(10);
    expect(patchDayNumber(null, NOW)).toBeNull();
  });

  it("composes an easing brief with a literal count-backed dek", () => {
    const brief = composeDispatchBrief(base);
    expect(brief.trend).toBe("easing");
    expect(brief.kicker).toBe("PATCH 1.13.01 · HOTFIX · DAY 10");
    expect(brief.headline).toBe("Reports are easing since 1.13.01 landed.");
    expect(brief.dek).toContain("12 player reports");
    expect(brief.dek).toContain("6 player taps");
    expect(brief.pulseHeadline).toContain("Signal is easing");
    // launch week 5+4+3+2+1+1+1 = 17; latest 7 days 2+1+1+1+1+0+1 = 7 → −59%.
    expect(brief.weeklyDeltaPct).toBe(-59);
    expect(formatWeeklyDelta(brief)).toBe("−59%");
    expect(weeklyDeltaSentence(brief)).toContain("Easing");
  });

  it("names the contested claim when players contest it", () => {
    const brief = composeDispatchBrief({
      ...base,
      contested: { title: "Map-open crash persists after fix", stillCount: 11, fixedCount: 5 },
      contestedClaimCount: 1,
    });
    expect(brief.headline).toContain("One claimed fix is still contested.");
    expect(brief.dek).toContain('"Map-open crash persists after fix"');
    expect(brief.dek).toContain("11 taps");
  });

  it("treats a fixed>still poll as not contested", () => {
    const brief = composeDispatchBrief({
      ...base,
      contested: { title: "Crowded-area performance", stillCount: 2, fixedCount: 8 },
    });
    expect(brief.headline).not.toContain("contested");
  });

  it("renders the quiet board as a real reading with literal zeros", () => {
    const brief = composeDispatchBrief({ ...base, reports: 0, taps: 0, series: days([0, 0, 0]) });
    expect(brief.trend).toBe("quiet");
    expect(brief.headline).toBe("A quiet board on 1.13.01.");
    expect(brief.pulseHeadline).toBe("No player signals filed yet this patch. A quiet board is a real reading.");
    expect(brief.dek).toContain("never fills in blanks");
  });

  it("shows a raw count instead of a percent when the launch week had no reports", () => {
    const brief = composeDispatchBrief({ ...base, series: days([0, 0, 0, 0, 0, 0, 0, 2, 1, 0]) });
    expect(brief.weeklyDeltaPct).toBeNull();
    expect(brief.latestWeekReports).toBe(3);
    expect(formatWeeklyDelta(brief)).toBe("3");
    expect(weeklyDeltaSentence(brief)).toContain("launch week had none");
  });

  it("defers the weekly comparison until seven rollup days are available", () => {
    const brief = composeDispatchBrief({ ...base, reports: 1, taps: 1, series: days([1]) });
    expect(brief.weeklyComparisonState).toBe("in_progress");
    expect(brief.weeklyDeltaPct).toBeNull();
    expect(brief.latestWeekReports).toBe(1);
    expect(formatWeeklyDelta(brief)).toBe("1");
    expect(weeklyDeltaSentence(brief)).toContain("after seven days");
    expect(brief.pulseHeadline).toContain("no launch-week comparison yet");
    expect(brief.headline).toBe("The first week on 1.13.01 is still in progress.");
  });

  it("reports rising when the latest week outpaces launch", () => {
    const brief = composeDispatchBrief({ ...base, series: days([1, 0, 0, 0, 0, 0, 0, 3, 4, 5]) });
    expect(brief.trend).toBe("rising");
    expect(brief.weeklyDeltaPct).toBeGreaterThan(0);
    expect(formatWeeklyDelta(brief).startsWith("+")).toBe(true);
  });

  it("handles a null series without inventing a delta", () => {
    expect(weeklyReportWindows(null)).toBeNull();
    const brief = composeDispatchBrief({ ...base, series: null });
    expect(brief.weeklyDeltaPct).toBeNull();
    expect(brief.trend).toBe("flat");
  });
});
