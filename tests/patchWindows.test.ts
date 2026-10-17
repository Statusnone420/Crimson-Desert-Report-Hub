import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateWindows } from "@/components/newspaper/UpdateWindows";
import type { ActivityDay, ActivityHistory } from "@/lib/activityHistory";
import { updateWindows } from "@/lib/patchWindows";

const DAY_MS = 86_400_000;

/**
 * Aug 1 to Sep 30. Until Aug 24: 100 new reviews a day, 80% positive, 100
 * Twitch viewers. From Aug 25: 200 a day, 70% positive, 300 viewers. Steam
 * players are recorded from Sep 20 only.
 */
function history(lanes: ActivityHistory["lanes"] = { players: "ready", twitch: "ready", reviews: "ready" }): ActivityHistory {
  const days: ActivityDay[] = [];
  for (let time = Date.parse("2026-08-01T00:00:00Z"); time <= Date.parse("2026-09-30T00:00:00Z"); time += DAY_MS) {
    const day = new Date(time).toISOString().slice(0, 10);
    const late = day >= "2026-08-25";
    const players = day >= "2026-09-20" ? 12000 : null;
    days.push({
      day,
      playersMin: players, playersMax: players, playersAvg: players, playerCaptures: players ? 12 : 0,
      twitchAvg: late ? 300 : 100, twitchPeak: late ? 400 : 150, twitchCaptures: 24,
      totalReviews: null, lifetimePositive: null,
      newReviews: late ? 200 : 100, newPositive: late ? 140 : 80,
    });
  }
  return { checkedAt: "2026-09-30T18:00:00.000Z", days, playerCaptures: [], lanes };
}

const patches = [
  { version: "1.17.00", publishedAt: "2026-08-03T03:00:00Z", fixes: 7 },
  { version: "1.18.00", publishedAt: "2026-08-15T03:00:00Z", fixes: 26 },
  { version: "2.00.00", publishedAt: "2026-08-25T02:00:00Z", fixes: 22 },
  { version: "2.00.01", publishedAt: "2026-08-28T05:00:00Z", fixes: 3 },
  { version: "2.01.00", publishedAt: "2026-09-04T02:00:00Z", fixes: 29 },
  { version: "2.02.00", publishedAt: "2026-09-08T02:00:00Z", fixes: 12 },
  // Two parts: an update, as the publication record reads it.
  { version: "2.03", publishedAt: "2026-09-26T01:00:00Z", fixes: 14 },
  { version: "2.04.00", publishedAt: null, fixes: 0 },
];

describe("update windows", () => {
  it("compares each update's week before with its week after, newest first", () => {
    const windows = updateWindows(history(), patches);
    // 1.17.00's week before starts before the first recorded day, so it is left out.
    expect(windows.map((window) => window.version)).toEqual(["2.03", "2.02.00", "2.01.00", "2.00.00", "1.18.00"]);
    const update = windows.find((window) => window.version === "2.00.00")!;
    expect(update.hotfixes).toEqual(["2.00.01"]);
    expect(update.measures.reviews).toMatchObject({ before: { state: "value", value: 100, days: 7 }, after: { state: "value", value: 200, days: 7 }, change: 100, direction: "up" });
    expect(update.measures.twitch).toMatchObject({ change: 200, direction: "up" });
    expect(update.measures.share.direction).toBe("down");
    expect(update.measures.share.change).toBeCloseTo(-10);
    expect(update.measures.players).toMatchObject({ before: { state: "missing" }, after: { state: "missing" }, direction: null });
  });

  it("leaves out the release day and stops a week at a neighbouring update", () => {
    const windows = updateWindows(history(), patches);
    // 2.01.00 and 2.02.00 are four days apart: three days between them on each side.
    expect(windows.find((window) => window.version === "2.01.00")!.measures.reviews.after).toEqual({ state: "close", neighbour: "2.02.00" });
    expect(windows.find((window) => window.version === "2.02.00")!.measures.reviews.before).toEqual({ state: "close", neighbour: "2.01.00" });
    // 1.18.00's week after ends on Aug 22, so the higher counts from Aug 25 never reach it.
    expect(windows.find((window) => window.version === "1.18.00")!.measures.reviews).toMatchObject({ change: 0, direction: "same" });
  });

  it("says when the week after is still filling and when a measure began too late", () => {
    const latest = updateWindows(history(), patches)[0];
    expect(latest.version).toBe("2.03");
    expect(latest.measures.reviews.after).toEqual({ state: "early", days: 4 });
    // Players from Sep 20: six recorded days before Sep 26 are enough.
    expect(latest.measures.players.before).toMatchObject({ state: "value", value: 12000, days: 6 });
    // Players from Sep 13 give 2.02.00's week after only three recorded days.
    const earlier = history();
    for (const day of earlier.days) {
      if (day.day >= "2026-09-13") Object.assign(day, { playersMin: 9000, playersMax: 9000, playersAvg: 9000 });
    }
    expect(updateWindows(earlier, patches).find((window) => window.version === "2.02.00")!.measures.players.after).toEqual({ state: "few", days: 3 });
  });

  it("reports a failed lane as unavailable on both sides", () => {
    const update = updateWindows(history({ players: "ready", twitch: "unavailable", reviews: "ready" }), patches).find((window) => window.version === "2.00.00")!;
    expect(update.measures.twitch).toEqual({ before: { state: "unavailable" }, after: { state: "unavailable" }, change: null, direction: null });
  });

  it("reads small moves as about the same", () => {
    const steady = history();
    for (const day of steady.days) {
      if (day.day >= "2026-08-25") Object.assign(day, { twitchAvg: 109, newReviews: 100, newPositive: 80.5 });
    }
    const update = updateWindows(steady, patches).find((window) => window.version === "2.00.00")!;
    expect(update.measures.twitch).toMatchObject({ direction: "same" });
    expect(update.measures.share).toMatchObject({ direction: "same" });
  });
});

describe("update by update", () => {
  it("shows a column only for measures with a comparison and explains the rest", () => {
    const html = renderToStaticMarkup(createElement(UpdateWindows, { history: history(), patches }));
    expect(html).toContain("Update by update");
    for (const text of ["New reviews a day", "Positive share", "Twitch viewers", "100 → 200", "up 100%", "10.0 points worse", "then hotfix 2.00.01", "too close to 2.02.00", "too early to tell, 4 days so far"]) {
      expect(html).toContain(text);
    }
    // No update has five player days on both sides: a note, not a column of gaps.
    expect(html).not.toContain("<dt>Playing on Steam</dt>");
    expect(html).toContain("Steam player counts begin on Sep 20, so no update has 5 recorded days on both sides yet.");
    expect(html).toContain("blue marks a better share");
  });

  it("names a failed read and an empty patch record honestly", () => {
    const failed = renderToStaticMarkup(createElement(UpdateWindows, { history: history({ players: "ready", twitch: "unavailable", reviews: "ready" }), patches }));
    expect(failed).toContain("Twitch viewer counts could not be read.");
    const none = renderToStaticMarkup(createElement(UpdateWindows, { history: history(), patches: [] }));
    expect(none).toContain("No official update was released in the recorded days");
  });
});
