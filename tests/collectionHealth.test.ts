import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectionHealth } from "@/components/scanner/CollectionHealth";
import { collectionHealth } from "@/lib/collectionHealth";

const now = new Date("2026-09-05T18:00:00.000Z");

function health(overrides: Partial<Parameters<typeof collectionHealth>[0]> = {}) {
  return collectionHealth({
    steamPulse: [],
    platformContext: null,
    pulseReadFailures: [],
    steamPulseEnabled: true,
    platformContextConfigured: true,
    scheduledCadenceMinutes: 60,
    now,
    ...overrides,
  });
}

function lane(result: ReturnType<typeof collectionHealth>, key: "steam" | "twitch" | "igdb") {
  const value = result.lanes.find((item) => item.key === key);
  if (!value) throw new Error(`Missing ${key} lane`);
  return value;
}

describe("collectionHealth", () => {
  it("keeps a four-hour-old Steam review capture current because Steam collects no more often than every six hours", () => {
    const result = health({
      steamPulse: [{ collectedAt: "2026-09-05T14:00:00.000Z" }],
      platformContext: {
        capturedAt: "2026-09-05T18:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "error",
        twitchComplete: null,
        twitchHistory: [{ capturedAt: "2026-09-05T17:00:00.000Z" }],
      },
    });

    expect(lane(result, "steam").state).toBe("ok");
    expect(lane(result, "twitch")).toMatchObject({
      state: "unavailable",
      lastSuccessfulCaptureAt: "2026-09-05T17:00:00.000Z",
      latestAttemptAt: "2026-09-05T18:00:00.000Z",
    });
    expect(lane(result, "igdb").state).toBe("ok");
    expect(result.attentionCount).toBe(1);
  });

  it("names failed saved-record reads without inventing zero captures", () => {
    const result = health({
      pulseReadFailures: ["steam", "platform"],
      steamPulse: [{ collectedAt: "2026-09-05T17:00:00.000Z" }],
    });

    expect(result.status).toBe("unknown");
    for (const key of ["steam", "twitch", "igdb"] as const) {
      expect(lane(result, key)).toMatchObject({
        state: "unknown",
        labelText: "Saved record unreadable",
        lastCaptureAt: null,
        detail: expect.stringContaining("could not be read"),
      });
    }
  });

  it("uses the collector interval plus scheduled cadence before calling a capture delayed", () => {
    const result = health({
      steamPulse: [{ collectedAt: "2026-09-05T10:59:59.999Z" }],
      platformContext: {
        capturedAt: "2026-09-05T15:59:59.999Z",
        igdbStatus: "ok",
        twitchStatus: "ok",
        twitchComplete: true,
        twitchHistory: [{ capturedAt: "2026-09-05T15:59:59.999Z" }],
      },
    });

    expect(lane(result, "steam").state).toBe("delayed");
    expect(lane(result, "twitch").state).toBe("delayed");
    expect(lane(result, "igdb").state).toBe("delayed");
  });

  it("keeps a capture current on the exact collection-window boundary and honors a longer scheduled cadence", () => {
    const boundary = health({
      steamPulse: [{ collectedAt: "2026-09-05T11:00:00.000Z" }],
      platformContext: {
        capturedAt: "2026-09-05T16:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "ok",
        twitchComplete: true,
        twitchHistory: [{ capturedAt: "2026-09-05T16:00:00.000Z" }],
      },
    });
    expect(boundary.lanes.map((item) => item.state)).toEqual(["ok", "ok", "ok"]);

    const onLongCadence = health({
      scheduledCadenceMinutes: 360,
      platformContext: {
        capturedAt: "2026-09-05T15:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "stale",
        twitchComplete: null,
        twitchHistory: [{ capturedAt: "2026-09-05T15:00:00.000Z" }],
      },
    });
    expect(lane(onLongCadence, "twitch")).toMatchObject({
      state: "ok",
      labelText: "On schedule",
      lastSuccessfulCaptureAt: "2026-09-05T15:00:00.000Z",
    });
  });

  it("explains the configured 120-minute scanner cadence separately from each provider interval", () => {
    const result = health({
      scheduledCadenceMinutes: 120,
      steamPulse: [{ collectedAt: "2026-09-05T09:59:59.999Z" }],
      platformContext: {
        capturedAt: "2026-09-05T14:59:59.999Z",
        igdbStatus: "stale",
        twitchStatus: "stale",
        twitchComplete: true,
        twitchHistory: [{ capturedAt: "2026-09-05T14:59:59.999Z" }],
      },
    });

    expect(lane(result, "steam")).toMatchObject({
      state: "delayed",
      detail: expect.stringContaining("6-hour Steam review collection interval plus the configured 120-minute scanner cadence (8 hours maximum age)"),
    });
    expect(lane(result, "twitch")).toMatchObject({
      state: "delayed",
      detail: expect.stringContaining("1-hour platform collection interval plus the configured 120-minute scanner cadence (3 hours maximum age)"),
    });
    expect(lane(result, "igdb").state).toBe("delayed");

    const twitchOnSchedule = health({
      scheduledCadenceMinutes: 120,
      platformContext: {
        capturedAt: "2026-09-05T15:30:00.000Z",
        igdbStatus: "stale",
        twitchStatus: "stale",
        twitchComplete: true,
        twitchHistory: [{ capturedAt: "2026-09-05T15:30:00.000Z" }],
      },
    });
    expect(lane(twitchOnSchedule, "twitch")).toMatchObject({
      state: "ok",
      labelText: "On schedule",
      detail: expect.stringContaining("separate 2-hour freshness limit"),
    });
    expect(lane(twitchOnSchedule, "igdb").state).toBe("ok");
  });

  it("reports disabled services and missing first captures distinctly", () => {
    const disabled = health({ steamPulseEnabled: false, platformContextConfigured: false });
    expect(disabled.lanes.map((item) => item.state)).toEqual(["disabled", "disabled", "disabled"]);
    expect(disabled.attentionCount).toBe(0);

    const noCaptures = health();
    expect(noCaptures.lanes.map((item) => item.state)).toEqual(["no_capture", "no_capture", "no_capture"]);
    expect(noCaptures.attentionCount).toBe(3);
  });

  it("does not call IGDB current when its only metadata capture is stale", () => {
    const result = health({
      platformContext: {
        capturedAt: "2026-09-05T14:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "stale",
        twitchComplete: null,
        twitchHistory: [{ capturedAt: "2026-09-05T14:00:00.000Z" }],
      },
    });

    expect(lane(result, "igdb").state).toBe("delayed");
    expect(lane(result, "twitch").state).toBe("delayed");
  });

  it("names incomplete responses and invalid timestamps without claiming healthy data", () => {
    const incomplete = health({
      platformContext: {
        capturedAt: "2026-09-05T18:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "ok",
        twitchComplete: null,
        twitchHistory: [],
      },
    });
    expect(lane(incomplete, "twitch")).toMatchObject({
      state: "incomplete",
      labelText: "Incomplete",
      nextAction: expect.stringContaining("next scheduled capture"),
    });

    const future = health({
      steamPulse: [{ collectedAt: "2026-09-05T18:00:01.000Z" }],
      platformContext: {
        capturedAt: "2026-09-05T18:00:01.000Z",
        igdbStatus: "ok",
        twitchStatus: "ok",
        twitchComplete: true,
        twitchHistory: [{ capturedAt: "2026-09-05T18:00:01.000Z" }],
      },
    });
    expect(future.lanes.map((item) => item.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(future.lanes.map((item) => item.labelText)).toEqual([
      "Invalid saved timestamp",
      "Invalid saved timestamp",
      "Invalid saved timestamp",
    ]);

    const mixed = health({
      steamPulse: [
        { collectedAt: "2026-09-05T17:00:00.000Z" },
        { collectedAt: "2026-09-05T18:00:01.000Z" },
      ],
    });
    expect(lane(mixed, "steam")).toMatchObject({
      state: "unknown",
      labelText: "Invalid saved timestamp",
      lastSuccessfulCaptureAt: "2026-09-05T17:00:00.000Z",
    });
  });

  it("keeps an unavailable provider response specific without guessing its cause", () => {
    const result = health({
      platformContext: {
        capturedAt: "2026-09-05T18:00:00.000Z",
        igdbStatus: "error",
        twitchStatus: "malformed",
        twitchComplete: null,
        twitchHistory: [],
      },
    });

    expect(lane(result, "twitch")).toMatchObject({
      state: "unavailable",
      detail: "The latest saved provider response is marked malformed. No more specific cause is recorded.",
      nextAction: "Inspect the saved response, then check the next scheduled capture.",
    });
    expect(lane(result, "igdb")).toMatchObject({
      state: "unavailable",
      detail: "The latest saved provider response is marked error. No more specific cause is recorded.",
    });
  });
});

describe("CollectionHealth", () => {
  it("keeps a failed Twitch attempt separate from healthy Steam and IGDB lanes", () => {
    const markup = renderToStaticMarkup(createElement(CollectionHealth, {
      steamPulse: [{ collectedAt: "2026-09-05T14:00:00.000Z" }],
      platformContext: {
        capturedAt: "2026-09-05T18:00:00.000Z",
        igdbStatus: "ok",
        twitchStatus: "error",
        twitchComplete: null,
        twitchHistory: [{ capturedAt: "2026-09-05T17:00:00.000Z" }],
      },
      pulseReadFailures: [],
      steamPulseEnabled: true,
      platformContextConfigured: true,
      scheduledCadenceMinutes: 60,
      nowIso: "2026-09-05T18:00:00.000Z",
    }));

    expect(markup).toContain("Collection health");
    expect(markup).toContain("Steam reviews");
    expect(markup).toContain("Current");
    expect(markup).toContain("Twitch audience");
    expect(markup).toContain("Provider unavailable");
    expect(markup).toContain("Last successful known capture");
    expect(markup).toContain("IGDB platform metadata");
    expect(markup).toContain("Next action:");
  });

  it("renders record-read and timestamp failures with distinct labels", () => {
    const unreadable = renderToStaticMarkup(createElement(CollectionHealth, {
      steamPulse: [],
      platformContext: null,
      pulseReadFailures: ["steam", "platform"],
      steamPulseEnabled: true,
      platformContextConfigured: true,
      scheduledCadenceMinutes: 120,
      nowIso: "2026-09-05T18:00:00.000Z",
    }));
    expect(unreadable).toContain("Saved record unreadable");
    expect(unreadable).toContain("Saved record could not be read");
    expect(unreadable).not.toContain(">Unknown<");

    const invalid = renderToStaticMarkup(createElement(CollectionHealth, {
      steamPulse: [{ collectedAt: "2026-09-05T18:00:01.000Z" }],
      platformContext: null,
      pulseReadFailures: [],
      steamPulseEnabled: true,
      platformContextConfigured: true,
      scheduledCadenceMinutes: 120,
      nowIso: "2026-09-05T18:00:00.000Z",
    }));
    expect(invalid).toContain("Invalid saved timestamp");
    expect(invalid).toContain("Saved capture timestamp is invalid");
  });
});
