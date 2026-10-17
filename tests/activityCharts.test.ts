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
import { readBoardWatchSummary } from "@/lib/boardWatch.server";
import { BeforeYouPlay } from "@/components/newspaper/BeforeYouPlay";
import { DailyReviews, reviewDayClass } from "@/components/newspaper/DailyReviews";
import { UpdateTimeline } from "@/components/newspaper/UpdateTimeline";

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

  it("labels every update in order and leaves hotfixes as ticks", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ day: `2026-09-${String(index + 1).padStart(2, "0")}` }));
    const markers = patchMarkers(days, [
      { version: "2.01.00", publishedAt: "2026-09-04T04:20:00Z", fixes: 29 },
      { version: "2.02.00", publishedAt: "2026-09-06T05:30:00Z", fixes: 12 },
      { version: "2.03.00", publishedAt: "2026-09-18T01:00:00Z", fixes: 14 },
      { version: "2.03.01", publishedAt: "2026-09-21T14:00:00Z", fixes: 3 },
      { version: "1.18.00", publishedAt: "2026-08-15T03:43:00Z", fixes: 26 },
      { version: "2.04.00", publishedAt: null, fixes: 0 },
    ]);
    // The order staggers labels on narrow screens instead of hiding any.
    expect(markers.map((marker) => [marker.version, marker.order])).toEqual([
      ["2.01.00", 0],
      ["2.02.00", 1],
      ["2.03.00", 2],
      ["2.03.01", null],
    ]);
    expect(monthTicks(days)).toEqual([{ x: 0, label: "Sep 1" }]);
  });

  it("reads a two-part version as an update, like the publication record", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ day: `2026-09-${String(index + 1).padStart(2, "0")}` }));
    const markers = patchMarkers(days, [
      { version: "2.03", publishedAt: "2026-09-18T01:00:00Z", fixes: 14 },
      { version: "2.03.01", publishedAt: "2026-09-25T14:00:00Z", fixes: 3 },
    ]);
    expect(markers.map((marker) => [marker.version, marker.update, marker.order])).toEqual([
      ["2.03", true, 0],
      ["2.03.01", false, null],
    ]);
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
  it("charts one measure at a time, each from its first record, with releases and a table twin", () => {
    const html = renderToStaticMarkup(createElement(UpdateTimeline, {
      history: history(),
      patches: [{ version: "2.03.02", publishedAt: "2026-09-23T04:45:00Z", fixes: 3 }, { version: "2.04.00", publishedAt: "2026-10-01T02:00:00Z", fixes: 20 }],
    }));
    for (const text of ["New reviews a day", "Twitch viewers", "Steam players", "Watching on Twitch", "Playing on Steam", "Read the daily numbers", "Choose a day: new Steam reviews", "Choose a day: Twitch viewers", "Choose a day: Steam players"]) {
      expect(html).toContain(text);
    }
    // The first measure shows; the others wait, still drawn, for their button.
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/class="dd-measure" hidden=""/g)).toHaveLength(2);
    // New reviews need two daily totals, so that chart starts a day later and says so.
    expect(html).toContain("Recorded since Sep 25.");
    expect(html).toContain("Shown for the last 24 days.");
    // One version format: the label, the readout and the table all say 2.04.00.
    expect(html).toContain(">2.04.00</span>");
    expect(html).toContain("<td>2.04.00</td>");
    // Only releases inside the plotted days are marked: 2.03.02 predates this window.
    expect(html).not.toContain("2.03.02");
    // Today is drawn lighter, named in the table, and the readout opens on the last full day.
    expect(html).toContain("dd-column is-partial");
    expect(html).toContain("Oct 17 (today so far)");
    expect(html).toContain("<strong>Oct 16</strong>");
    // One announcement per day: the slider's value text, not a live readout as well.
    expect(html).not.toContain("aria-live");
  });

  it("marks a day that lost reviews differently from a day without a record", () => {
    const lossy = history();
    Object.assign(lossy.days[5], { newReviews: -12, newPositive: -9 });
    Object.assign(lossy.days[6], { newReviews: null, newPositive: null });
    const timeline = renderToStaticMarkup(createElement(UpdateTimeline, { history: lossy, patches: [] }));
    expect(timeline).toContain("dd-column is-loss");
    expect(timeline).toContain("A short mark under the line means more reviews were removed than added.");
    const strip = renderToStaticMarkup(createElement(DailyReviews, { history: lossy, patches: [] }));
    expect(strip).toContain("dd-cell is-loss");
    expect(strip).toContain("more removed than added");
    expect(strip).toContain("dd-cell is-empty");
  });

  it("names an unavailable lane instead of drawing it as zero", () => {
    const html = renderToStaticMarkup(createElement(UpdateTimeline, { history: history({ players: "ready", twitch: "unavailable", reviews: "ready" }), patches: [] }));
    expect(html).toContain("Twitch viewer counts could not be read.");
  });

  it("does not read an unread patch record as a quiet one", () => {
    const quiet = renderToStaticMarkup(createElement(UpdateTimeline, { history: history(), patches: [] }));
    expect(quiet).toContain("No official release since then.");
    expect(quiet).toContain('<th scope="col">Release</th>');
    const unread = renderToStaticMarkup(createElement(UpdateTimeline, { history: history(), patches: [], patchesUnavailable: true }));
    expect(unread).not.toContain("No official release");
    expect(unread).not.toContain("Labeled lines mark official updates");
    expect(unread).toContain("Updates are not marked, because the official patch record could not be read.");
    expect(unread).not.toContain('<th scope="col">Release</th>');
  });

  it("colors review days red when worse and blue when better than the usual, and leaves small days uncolored", () => {
    expect([-12, -6, -3, -2, 0, 2, 2.1, 7, 15].map(reviewDayClass)).toEqual([
      "rv-w3", "rv-w2", "rv-w1", "rv-z", "rv-z", "rv-z", "rv-b1", "rv-b2", "rv-b3",
    ]);
    const html = renderToStaticMarkup(createElement(DailyReviews, { history: history(), patches: [] }));
    expect(html).toContain("Each day&#x27;s Steam reviews");
    expect(html).toContain("Blue days were better than usual, red days worse");
    // Every share names its window, and today stays out of the usual.
    expect(html).toContain("against the 24-day usual of 80.0%");
    expect(html).toContain("dd-cell is-partial");
    expect(html).toContain("Oct 17 (today so far)");
    expect(html).toContain('aria-label="Choose a day: each day&#x27;s Steam reviews"');
    // One scale from worse to better above the strip, read in words by screen readers.
    expect(html.indexOf("dd-scale-steps")).toBeLessThan(html.indexOf("dd-ribbon"));
    expect(html).toContain("10 or more points worse");
    expect(html).toContain("10 or more points better");
    expect(html).toContain("under 50 new reviews");
    expect(html).toContain("dd-cell is-empty");
    expect(html).not.toMatch(/warm|cool|mood|colour/i);
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

  it("counts only the game's Steam forum threads, not other Steam Community pages", async () => {
    const rows = [
      { id: "1", category: "crash_startup", cluster_id: "a", canonical_url: "https://steamcommunity.com/app/3321460/discussions/0/600000000000000001" },
      { id: "2", category: "crash_startup", cluster_id: "b", canonical_url: "https://steamcommunity.com/sharedfiles/filedetails/?id=3500000000" },
      { id: "3", category: "audio", cluster_id: "c", canonical_url: "https://steamcommunity.com/app/1000000/discussions/0/600000000000000002" },
    ];
    type Query = Record<"select" | "eq" | "neq" | "not" | "gte" | "order", () => Query> & {
      range: () => Promise<{ data: typeof rows; error: null }>;
    };
    const query: Query = {
      select: () => query, eq: () => query, neq: () => query, not: () => query, gte: () => query, order: () => query,
      range: async () => ({ data: rows, error: null }),
    };
    const supabase = { from: () => query } as unknown as Parameters<typeof readBoardWatchSummary>[0];
    expect(await readBoardWatchSummary(supabase, { version: "2.03.02", publishedAt: "2026-09-23T04:45:00Z" })).toEqual({
      patchVersion: "2.03.02", threads: 1, topics: 1, systems: [{ category: "crash_startup", threads: 1 }],
    });
  });

  it("reports failed notes and scanner reads as unavailable, not as an empty record", () => {
    const html = renderToStaticMarkup(createElement(BeforeYouPlay, {
      history: history(),
      latestPatch: { version: "2.03.02", publishedAt: "2026-09-23T04:45:00Z", fixes: null, notesUnavailable: true },
      watch: "unavailable",
    }));
    expect(html).toContain("the official notes could not be read");
    expect(html).not.toContain("official notes not listed yet");
    expect(html).toContain("On the radar");
    expect(html).toContain("The scanner&#x27;s thread counts could not be read.");
    expect(html).not.toContain("The scanner is watching");
  });
});
