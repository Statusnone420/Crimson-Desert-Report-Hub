import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScrubItem } from "@/components/newspaper/DayScrubber";
import { DailyReviews } from "@/components/newspaper/DailyReviews";
import { UpdateTimeline } from "@/components/newspaper/UpdateTimeline";
import { buildActivityDays, type ActivityHistory } from "@/lib/activityHistory";

// Every day's readout, not only the one each slider opens on.
vi.mock("@/components/newspaper/DayScrubber", () => ({
  DayScrubber: ({ items, children }: { items: ScrubItem[]; children: ReactNode }) =>
    createElement("div", null, children, ...items.map((item) => createElement("p", { key: item.title }, `${item.title}: ${item.detail}`))),
}));

/** Oct 1 to 10, today. A review total every day except Oct 5, so Oct 6 has a total but no change. */
function gapHistory(): ActivityHistory {
  const from = Date.parse("2026-10-01T00:00:00Z");
  const to = Date.parse("2026-10-10T12:00:00Z");
  const reviews = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => index !== 4)
    .map((index) => ({ day: `2026-10-${String(index + 1).padStart(2, "0")}`, totalReviews: 1000 + index * 100, totalPositive: 800 + index * 80, positivePercentage: 80 }));
  return {
    checkedAt: "2026-10-10T12:00:00.000Z",
    days: buildActivityDays({ from, to, players: [], twitch: [], reviews }),
    playerCaptures: [],
    lanes: { players: "empty", twitch: "empty", reviews: "ready" },
  };
}

describe("days without a review change", () => {
  it("tell a day with no record from a recorded day that has no day before", () => {
    const strip = renderToStaticMarkup(createElement(DailyReviews, { history: gapHistory(), patches: [] }));
    expect(strip).toContain("Oct 5: No Steam review record for this day");
    expect(strip).toContain("Oct 6: No change to show: the day before has no Steam review record");
    const timeline = renderToStaticMarkup(createElement(UpdateTimeline, { history: gapHistory(), patches: [] }));
    expect(timeline).toContain("Oct 5: no review record");
    expect(timeline).toContain("Oct 6: no change to show: the day before has no review record");
  });

  it("names the empty square for every day without a share, not only days without a record", () => {
    const strip = renderToStaticMarkup(createElement(DailyReviews, { history: gapHistory(), patches: [] }));
    expect(strip).toContain("no share to show");
    expect(strip).not.toContain(">no record<");
  });
});
