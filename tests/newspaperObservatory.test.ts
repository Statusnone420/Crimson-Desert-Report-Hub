import { describe, expect, it } from "vitest";
import {
  buildRadarCategories,
  buildSteamReviewSeries,
  buildTwitchSeries,
  selectSteamReadings,
  selectTwitchWindow,
  twitchHistorySummary,
} from "@/lib/newspaperObservatory";
import type { PatchRadarData } from "@/lib/radar.server";

describe("newspaper observatory adapters", () => {
  it("does not manufacture exact Steam sentiment from a rounded percentage", () => {
    const series = buildSteamReviewSeries([
      {
        snapshotDay: "2026-09-01",
        collectedAt: "2026-09-01T12:00:00.000Z",
        totalReviews: 100,
        positivePercentage: 83.8,
        reviewCountDelta: null,
        reviewsScanned: 0,
        issueLanguageCount: 0,
        leadsRetained: 0,
      },
      {
        snapshotDay: "2026-09-02",
        collectedAt: "2026-09-02T12:00:00.000Z",
        totalReviews: 105,
        totalPositive: 88,
        totalNegative: 17,
        positivePercentage: 83.8,
        reviewCountDelta: -2,
        reviewsScanned: 0,
        issueLanguageCount: 0,
        leadsRetained: 0,
      },
    ], false);

    expect(series.points[0]).toMatchObject({ totalPositive: null, totalNegative: null, reviewMovement: null });
    expect(series.points[1]).toMatchObject({ totalPositive: 88, totalNegative: 17, reviewMovement: -2 });
    expect(series.points[1].positiveMovement).toBeNull();
  });

  it("selects review readings, not invented calendar-day coverage", () => {
    const series = buildSteamReviewSeries(Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return {
        snapshotDay: "2026-08-" + day,
        collectedAt: "2026-08-" + day + "T12:00:00.000Z",
        totalReviews: 100 + index,
        totalPositive: 80 + index,
        totalNegative: 20,
        positivePercentage: 80,
        reviewCountDelta: 1,
        reviewsScanned: 0,
        issueLanguageCount: 0,
        leadsRetained: 0,
      };
    }), false);
    expect(selectSteamReadings(series.points, 7)).toHaveLength(7);
  });

  it("anchors Twitch windows to the checked capture and breaks a wide gap", () => {
    const series = buildTwitchSeries({
      capturedAt: "2026-09-05T08:00:00.000Z",
      igdbStatus: "ok",
      releaseAt: null,
      platforms: [],
      igdbUrl: null,
      twitchStatus: "ok",
      liveStreams: 8,
      liveViewers: 200,
      twitchComplete: true,
      twitchHistory: [
        { capturedAt: "2026-09-05T00:00:00.000Z", liveStreams: 2, liveViewers: 50 },
        { capturedAt: "2026-09-05T02:00:00.000Z", liveStreams: 4, liveViewers: 90 },
        { capturedAt: "2026-09-05T07:00:00.000Z", liveStreams: 8, liveViewers: 200 },
        { capturedAt: "2026-09-05T10:00:00.000Z", liveStreams: 9, liveViewers: 300 },
      ],
    }, false);
    const window = selectTwitchWindow(series, 24);

    expect(window?.points).toHaveLength(3);
    expect(window?.segments.map((segment) => segment.length)).toEqual([2, 1]);
    expect(series.latestState).toBe("fresh");
  });

  it("keeps complete historical Twitch captures chartable when the latest capture is delayed", () => {
    const series = buildTwitchSeries({
      capturedAt: "2026-09-12T12:00:00.000Z",
      igdbStatus: "ok", releaseAt: null, platforms: [], igdbUrl: null,
      twitchStatus: "stale", liveStreams: null, liveViewers: null, twitchComplete: null,
      twitchHistory: [
        { capturedAt: "2026-09-12T08:00:00.000Z", liveStreams: 4, liveViewers: 80 },
        { capturedAt: "2026-09-12T10:00:00.000Z", liveStreams: 6, liveViewers: 120 },
      ],
    }, false);

    expect(series).toMatchObject({ availability: "ready", checkedAt: "2026-09-12T12:00:00.000Z", latestCapturedAt: "2026-09-12T10:00:00.000Z", latestState: "delayed" });
    expect(selectTwitchWindow(series, 24)?.points).toHaveLength(2);
    expect(twitchHistorySummary(series)).toBe("Latest Twitch capture is delayed. Historical captures are not live.");
  });

  it("keeps earlier complete captures when the latest Twitch response is unavailable", () => {
    const series = buildTwitchSeries({
      capturedAt: "2026-09-12T12:00:00.000Z",
      igdbStatus: "ok", releaseAt: null, platforms: [], igdbUrl: null,
      twitchStatus: "error", liveStreams: null, liveViewers: null, twitchComplete: null,
      twitchHistory: [{ capturedAt: "2026-09-12T09:00:00.000Z", liveStreams: 3, liveViewers: 60 }],
    }, false);

    expect(series).toMatchObject({ availability: "ready", checkedAt: "2026-09-12T12:00:00.000Z", latestCapturedAt: "2026-09-12T09:00:00.000Z", latestState: "unavailable" });
    expect(twitchHistorySummary(series)).toBe("The latest Twitch response was unavailable. Historical captures are not live.");
  });

  it("distinguishes an unread history from no recorded or no complete Twitch data", () => {
    expect(twitchHistorySummary(buildTwitchSeries(null, true))).toBe("Twitch aggregate history could not be read.");
    expect(twitchHistorySummary(buildTwitchSeries(null, false))).toBe("No Twitch aggregate captures have been recorded yet.");
    expect(twitchHistorySummary(buildTwitchSeries({
      capturedAt: "2026-09-12T12:00:00.000Z",
      igdbStatus: "ok", releaseAt: null, platforms: [], igdbUrl: null,
      twitchStatus: "absent", liveStreams: null, liveViewers: null, twitchComplete: false, twitchHistory: [],
    }, false))).toBe("No complete Twitch aggregate captures have been recorded yet.");
  });

  it.each([
    { capturedAt: "2026-09-12T12:00:00.000Z", twitchComplete: false, state: "incomplete", reason: "is incomplete" },
    { capturedAt: "invalid", twitchComplete: true, state: "invalid_timestamp", reason: "has an invalid timestamp" },
  ])("retains history with a precise warning when the latest capture $state", ({ capturedAt, twitchComplete, state, reason }) => {
    const series = buildTwitchSeries({
      capturedAt,
      igdbStatus: "ok", releaseAt: null, platforms: [], igdbUrl: null,
      twitchStatus: "ok", liveStreams: 4, liveViewers: 80, twitchComplete,
      twitchHistory: [{ capturedAt: "2026-09-12T09:00:00.000Z", liveStreams: 3, liveViewers: 60 }],
    }, false);

    expect(series).toMatchObject({ availability: "ready", latestState: state, latestCapturedAt: "2026-09-12T09:00:00.000Z" });
    expect(selectTwitchWindow(series, 24)?.points).toHaveLength(1);
    expect(twitchHistorySummary(series)).toBe(`The latest Twitch capture ${reason}. Historical captures are not live.`);
  });

  it("marks unread provider and radar data unavailable instead of zero", () => {
    expect(buildSteamReviewSeries([], true)).toMatchObject({ availability: "unavailable", points: [] });
    expect(buildTwitchSeries(null, true)).toMatchObject({ availability: "unavailable", points: [], latestState: "unread" });
    expect(buildRadarCategories({ connected: false } as PatchRadarData)).toMatchObject({
      availability: "unavailable",
      categories: [],
    });
  });
});
