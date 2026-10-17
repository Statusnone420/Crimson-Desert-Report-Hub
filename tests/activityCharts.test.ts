import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  bandPath,
  columnRects,
  compactNumber,
  linePath,
  monthTicks,
  niceCeiling,
  patchMarkers,
  timeLinePath,
} from "@/lib/activityCharts";
import { buildActivityDays, type ActivityHistory } from "@/lib/activityHistory";
import { summarizeBoardWatch } from "@/lib/boardWatch";
import { BeforeYouPlay } from "@/components/newspaper/BeforeYouPlay";
import { MoodRibbon, moodClass } from "@/components/newspaper/MoodRibbon";
import { PatchSeismograph } from "@/components/newspaper/PatchSeismograph";

describe("chart geometry", () => {
  it("rounds axis tops up to readable values", () => {
    expect([0, 1, 503, 1548, 28723].map(niceCeiling)).toEqual([1, 1, 600, 2000, 30000]);
    expect([0, 300, 1500, 30000].map(compactNumber)).toEqual(["0", "300", "1.5K", "30K"]);
  });

  it("breaks lines at missing days and never draws a lone point as a line", () => {
    expect(linePath([10, null, 20, 30], 0, 40)).toBe("M125.0,75.0M625.0,50.0L875.0,25.0");
    expect(linePath([null, null], 0, 10)).toBe("");
  });

  it("widens a lone day in a band to its slot", () => {
    expect(bandPath([0, null, 0], [10, null, 10], 0, 10)).toBe("M0.0,0.0L333.3,0.0L333.3,100.0L0.0,100.0ZM666.7,0.0L1000.0,0.0L1000.0,100.0L666.7,100.0Z");
  });

  it("draws columns only for positive values", () => {
    const rects = columnRects([5, 0, -3, null, 10], 10);
    expect(rects.map((rect) => rect.index)).toEqual([0, 4]);
    expect(rects[1].height).toBe(100);
  });

  it("breaks a time line at gaps longer than the limit", () => {
    const hour = 3_600_000;
    const path = timeLinePath([{ time: 0, value: 1 }, { time: 2 * hour, value: 2 }, { time: 10 * hour, value: 3 }], 0, 10 * hour, 4, 3.25 * hour);
    expect(path.match(/M/g)).toHaveLength(2);
  });

  it("labels updates, thins crowded labels, and leaves hotfixes as ticks", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ day: `2026-09-${String(index + 1).padStart(2, "0")}` }));
    const markers = patchMarkers(days, [
      { version: "2.01.00", publishedAt: "2026-09-04T04:20:00Z", fixes: 29 },
      { version: "2.02.00", publishedAt: "2026-09-06T05:30:00Z", fixes: 12 },
      { version: "2.03.00", publishedAt: "2026-09-18T01:00:00Z", fixes: 14 },
      { version: "2.03.01", publishedAt: "2026-09-21T14:00:00Z", fixes: 3 },
      { version: "1.18.00", publishedAt: "2026-08-15T03:43:00Z", fixes: 26 },
      { version: "2.04.00", publishedAt: null, fixes: 0 },
    ]);
    expect(markers.map((marker) => [marker.version, marker.label])).toEqual([
      ["2.01.00", "always"],
      ["2.02.00", "wide"],
      ["2.03.00", "always"],
      ["2.03.01", null],
    ]);
    expect(monthTicks(days)).toEqual([{ x: 0, label: "Sep 1" }]);
  });
});

function history(lanes: ActivityHistory["lanes"] = { players: "ready", twitch: "ready", reviews: "ready" }): ActivityHistory {
  const from = Date.parse("2026-09-24T00:00:00Z");
  const to = Date.parse("2026-10-17T16:00:00Z");
  const players = [];
  for (let time = from + 16 * 3_600_000; time <= to; time += 2 * 3_600_000) {
    players.push({ capturedAt: new Date(time).toISOString(), playerCount: 10000 + (new Date(time).getUTCHours() * 300) });
  }
  const reviews = Array.from({ length: 24 }, (_, index) => ({
    day: new Date(from + index * 86_400_000).toISOString().slice(0, 10),
    totalReviews: 175000 + index * 100,
    totalPositive: 146000 + index * 80,
    positivePercentage: 83.7,
  }));
  const twitch = players.map((capture) => ({ capturedAt: capture.capturedAt, liveViewers: 150 }));
  return {
    checkedAt: "2026-10-17T16:30:00.000Z",
    days: buildActivityDays({ from, to, players, twitch, reviews }),
    playerCaptures: players,
    lanes,
  };
}

describe("activity components", () => {
  it("renders the seismograph with every panel, releases and a table twin", () => {
    const html = renderToStaticMarkup(createElement(PatchSeismograph, {
      history: history(),
      patches: [{ version: "2.03.02", publishedAt: "2026-09-23T04:45:00Z", fixes: 3 }, { version: "2.04.00", publishedAt: "2026-10-01T02:00:00Z", fixes: 20 }],
    }));
    for (const text of ["Watching on Twitch", "New Steam reviews", "Share positive", "Playing on Steam", "Read the daily numbers", "Move through the days"]) {
      expect(html).toContain(text);
    }
    // Only releases inside the plotted days are marked: 2.03.02 predates this window.
    expect(html).toContain(">2.04<");
    expect(html).toContain("<td>2.04.00</td>");
    expect(html).not.toContain("2.03.02");
  });

  it("names an unavailable lane instead of drawing it as zero", () => {
    const html = renderToStaticMarkup(createElement(PatchSeismograph, { history: history({ players: "ready", twitch: "unavailable", reviews: "ready" }), patches: [] }));
    expect(html).toContain("Twitch viewer counts could not be read.");
  });

  it("colours mood days by their distance from the period average and leaves small days uncoloured", () => {
    expect([-12, -6, -3, -2, 0, 2, 2.1, 7, 15].map(moodClass)).toEqual([
      "mood-n3", "mood-n2", "mood-n1", "mood-z", "mood-z", "mood-z", "mood-p1", "mood-p2", "mood-p3",
    ]);
    const html = renderToStaticMarkup(createElement(MoodRibbon, { history: history(), patches: [] }));
    expect(html).toContain("The mood ribbon");
    expect(html).toContain("under 50 new reviews");
    expect(html).toContain("dd-cell is-empty");
  });

  it("shows the latest readings with honest fallbacks and only counts from the scanner", () => {
    const watch = summarizeBoardWatch([
      { category: "crash_startup", cluster_id: "a" }, { category: "crash_startup", cluster_id: "a" },
      { category: "quest_progression", cluster_id: "b" }, { category: "made_up", cluster_id: "c" },
      // Kept without a topic, such as a junk title: not a watched thread.
      { category: "audio", cluster_id: null }, { category: "audio" },
    ], "2.03.02");
    expect(watch).toEqual({
      patchVersion: "2.03.02", threads: 4, topics: 3,
      systems: [{ category: "crash_startup", threads: 2 }, { category: "other", threads: 1 }, { category: "quest_progression", threads: 1 }],
    });
    const html = renderToStaticMarkup(createElement(BeforeYouPlay, {
      history: history(),
      latestPatch: { version: "2.03.02", publishedAt: "2026-09-23T04:45:00Z", fixes: 3 },
      watch,
    }));
    expect(html).toContain("Playing on Steam");
    expect(html).toContain("Steam mood, last 7 days");
    expect(html).toContain("24 days ago · 3 listed fixes");
    expect(html).toContain("3 topics");
    expect(html).toContain("These are leads, not confirmed reports.");
    const unavailable = renderToStaticMarkup(createElement(BeforeYouPlay, {
      history: history({ players: "unavailable", twitch: "ready", reviews: "unavailable" }),
      latestPatch: null,
      watch: null,
    }));
    expect(unavailable).toContain("Steam player counts could not be read.");
    expect(unavailable).toContain("Steam review totals could not be read.");
    expect(unavailable).toContain("The official patch record could not be read.");
    expect(unavailable).not.toContain("On the radar");
  });
});
