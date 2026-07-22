import { describe, expect, it } from "vitest";
import {
  formatSignedReviewDelta,
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
});
