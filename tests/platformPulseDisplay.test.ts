import { describe, expect, it } from "vitest";
import {
  canonicalIgdbUrl,
  formatHistoryChange,
  formatSignedReviewDelta,
  summarizeSteamHistory,
  summarizeTwitchHistory,
  platformUnavailableMessage,
  platformContextIsStale,
  reviewDeltaTone,
  twitchCoverageLabel,
} from "@/lib/platformPulseDisplay";

describe("platform pulse display helpers", () => {
  it("formats signed review deltas correctly", () => {
    expect(formatSignedReviewDelta(5)).toBe("+5");
    expect(formatSignedReviewDelta(0)).toBe("0");
    expect(formatSignedReviewDelta(-3)).toBe("-3");
    expect(formatSignedReviewDelta(Number.NaN)).toBe("0");
  });

  it("classifies delta tone for rendering", () => {
    expect(reviewDeltaTone(7)).toBe("positive");
    expect(reviewDeltaTone(0)).toBe("flat");
    expect(reviewDeltaTone(-2)).toBe("negative");
    expect(reviewDeltaTone(Number.NaN)).toBe("flat");
  });

  it("returns human-readable provider unavailability reasons", () => {
    expect(platformUnavailableMessage("IGDB", "absent")).toBe("IGDB has no snapshot match for this check.");
    expect(platformUnavailableMessage("Twitch", "unconfigured")).toBe("Twitch credentials are not configured.");
    expect(platformUnavailableMessage("IGDB", "malformed")).toBe("IGDB returned malformed snapshot data.");
    expect(platformUnavailableMessage("Twitch", "stale")).toBe("Twitch live counts are stale and have been hidden.");
    expect(platformUnavailableMessage("Twitch", "error")).toBe("Twitch request failed.");
    expect(platformUnavailableMessage("IGDB", "ok")).toBe("");
  });

  it("marks old or invalid live snapshots stale", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    expect(platformContextIsStale("2026-07-22T10:30:00.000Z", now)).toBe(false);
    expect(platformContextIsStale("2026-07-22T09:59:59.999Z", now)).toBe(true);
    expect(platformContextIsStale("not-a-date", now)).toBe(true);
  });

  it("distinguishes complete, partial, and unavailable Twitch coverage", () => {
    expect(twitchCoverageLabel(true)).toBe("Complete point-in-time count");
    expect(twitchCoverageLabel(false)).toBe("Point-in-time partial count");
    expect(twitchCoverageLabel(null)).toBe("No Twitch count available");
  });

  it("keeps one real Steam snapshot as an honest collecting-history state", () => {
    const history = summarizeSteamHistory([{
      snapshotDay: "2026-07-23",
      totalReviews: 164_600,
      positivePercentage: 84,
    }]);

    expect(history).toMatchObject({
      status: "collecting",
      snapshotCount: 1,
      windowDays: 7,
      points: [{ snapshotDay: "2026-07-23", totalReviews: 164_600, positivePercentage: 84 }],
    });
  });

  it("summarizes actual Steam review-volume and positivity history without filling gaps", () => {
    const history = summarizeSteamHistory(Array.from({ length: 8 }, (_, index) => ({
      snapshotDay: `2026-07-${String(16 + index).padStart(2, "0")}`,
      totalReviews: 164_000 + index * 100,
      positivePercentage: 83.5 + index * 0.1,
    })));

    expect(history).toMatchObject({
      status: "ready",
      snapshotCount: 8,
      windowDays: 14,
      reviewChange: 700,
    });
    expect(history.positivityChange).toBeCloseTo(0.7);
    expect(history.points).toHaveLength(8);
    expect(formatHistoryChange(history.reviewChange, "reviews")).toBe("+700");
    expect(formatHistoryChange(history.positivityChange, "points")).toBe("+0.7 pts");
  });

  it("preserves recorded Steam review movement and leaves missing values empty", () => {
    const history = summarizeSteamHistory([
      {
        snapshotDay: "2026-07-20",
        totalReviews: 164_000,
        positivePercentage: 83.5,
        reviewCountDelta: null,
      },
      {
        snapshotDay: "2026-07-22",
        totalReviews: 164_023,
        positivePercentage: 83.7,
        reviewCountDelta: 23,
      },
      {
        snapshotDay: "2026-07-23",
        totalReviews: 164_019,
        positivePercentage: 83.6,
        reviewCountDelta: -4,
      },
      {
        snapshotDay: "2026-07-24",
        totalReviews: 164_019,
        positivePercentage: 83.6,
        reviewCountDelta: Number.NaN,
      },
    ]);

    expect(history.points.map((point) => ({
      snapshotDay: point.snapshotDay,
      reviewCountDelta: point.reviewCountDelta,
    }))).toEqual([
      { snapshotDay: "2026-07-20", reviewCountDelta: null },
      { snapshotDay: "2026-07-22", reviewCountDelta: 23 },
      { snapshotDay: "2026-07-23", reviewCountDelta: -4 },
      { snapshotDay: "2026-07-24", reviewCountDelta: null },
    ]);
  });

  it("keeps Twitch history compact until two valid snapshots exist", () => {
    const history = summarizeTwitchHistory([{
      capturedAt: "2026-07-23T11:30:00.000Z",
      liveStreams: 53,
      liveViewers: 205,
    }], new Date("2026-07-23T12:00:00.000Z"));

    expect(history).toMatchObject({
      status: "collecting",
      snapshotCount: 1,
      currentViewers: 205,
      peakViewers: null,
      lowViewers: null,
      viewerChange: null,
    });
  });

  it("derives Twitch current, peak, low, and change from actual snapshots in the last 24 hours", () => {
    const history = summarizeTwitchHistory([
      { capturedAt: "2026-07-22T05:00:00.000Z", liveStreams: 70, liveViewers: 900 },
      { capturedAt: "2026-07-23T02:00:00.000Z", liveStreams: 40, liveViewers: 180 },
      { capturedAt: "2026-07-23T08:00:00.000Z", liveStreams: 65, liveViewers: 320 },
      { capturedAt: "2026-07-23T11:30:00.000Z", liveStreams: 53, liveViewers: 205 },
    ], new Date("2026-07-23T12:00:00.000Z"));

    expect(history).toMatchObject({
      status: "ready",
      snapshotCount: 3,
      currentStreams: 53,
      currentViewers: 205,
      peakViewers: 320,
      lowViewers: 180,
      viewerChange: 25,
    });
  });

  it("builds only canonical IGDB game links from safe slugs", () => {
    expect(canonicalIgdbUrl("crimson-desert")).toBe("https://www.igdb.com/games/crimson-desert");
    expect(canonicalIgdbUrl("../users")).toBeNull();
    expect(canonicalIgdbUrl(null)).toBeNull();
  });
});
