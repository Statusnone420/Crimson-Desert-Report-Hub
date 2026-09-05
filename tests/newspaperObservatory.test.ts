import { describe, expect, it } from "vitest";
import {
  buildRadarCategories,
  buildSteamReviewSeries,
  buildTwitchSeries,
  selectSteamReadings,
  selectTwitchWindow,
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
  });

  it("marks unread provider and radar data unavailable instead of zero", () => {
    expect(buildSteamReviewSeries([], true)).toMatchObject({ availability: "unavailable", points: [] });
    expect(buildTwitchSeries(null, true)).toMatchObject({ availability: "unavailable", points: [] });
    expect(buildRadarCategories({ connected: false } as PatchRadarData)).toMatchObject({
      availability: "unavailable",
      categories: [],
    });
  });
});
