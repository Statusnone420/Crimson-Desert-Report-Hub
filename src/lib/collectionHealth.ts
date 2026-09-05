export const STEAM_COLLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PLATFORM_COLLECTION_INTERVAL_MS = 60 * 60 * 1000;

export type CollectionHealthState =
  | "ok"
  | "disabled"
  | "unknown"
  | "no_capture"
  | "delayed"
  | "incomplete"
  | "unavailable";

export type CollectionHealthLane = {
  key: "steam" | "twitch" | "igdb";
  label: string;
  state: CollectionHealthState;
  labelText: string;
  lastCaptureAt: string | null;
  lastSuccessfulCaptureAt: string | null;
  latestAttemptAt: string | null;
  detail: string;
  nextAction: string | null;
  needsAttention: boolean;
};

export type CollectionHealth = {
  lanes: CollectionHealthLane[];
  attentionCount: number;
  status: "ok" | "attention" | "unknown";
};

export type CollectionHealthInput = {
  steamPulse: readonly { collectedAt: string }[];
  platformContext: {
    capturedAt: string;
    igdbStatus: string;
  twitchStatus: string;
  twitchComplete: boolean | null;
  /** Successful, complete Twitch captures retained by the public read model. */
  twitchHistory: readonly { capturedAt: string }[];
  } | null;
  pulseReadFailures: readonly ("steam" | "platform")[];
  steamPulseEnabled: boolean;
  platformContextConfigured: boolean;
  scheduledCadenceMinutes: number;
  now: Date;
};

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

type CaptureRead = { latest: string | null; hasInvalidTimestamp: boolean };

function latestCapture<T extends { capturedAt?: string; collectedAt?: string }>(
  rows: readonly T[],
  now: Date,
): CaptureRead {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  let hasInvalidTimestamp = false;
  const nowTime = now.getTime();
  for (const row of rows) {
    const value = row.capturedAt ?? row.collectedAt ?? null;
    const time = timeOf(value);
    if (time === null || !Number.isFinite(nowTime) || time > nowTime) {
      hasInvalidTimestamp = true;
    } else if (time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return { latest, hasInvalidTimestamp };
}

function cadenceMs(minutes: number): number {
  return Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes * 60 * 1000) : 60 * 60 * 1000;
}

/**
 * A capture can occur only after its own minimum interval and the next scanner
 * run. This grace makes a six-hour Steam reading normal rather than a failure,
 * while retaining the existing two-hour threshold for an hourly platform scan.
 */
function isDelayed(capturedAt: string, minimumIntervalMs: number, input: CollectionHealthInput): boolean {
  const capturedTime = timeOf(capturedAt);
  const now = input.now.getTime();
  if (capturedTime === null || !Number.isFinite(now) || capturedTime > now) return false;
  return now - capturedTime > minimumIntervalMs + cadenceMs(input.scheduledCadenceMinutes);
}

function lane(
  base: Omit<CollectionHealthLane, "needsAttention">,
): CollectionHealthLane {
  return {
    ...base,
    needsAttention: base.state !== "ok" && base.state !== "disabled",
  };
}

function disabledLane(key: CollectionHealthLane["key"], label: string): CollectionHealthLane {
  return lane({
    key,
    label,
    state: "disabled",
    labelText: "Disabled",
    lastCaptureAt: null,
    lastSuccessfulCaptureAt: null,
    latestAttemptAt: null,
    detail: "Collection is disabled by configuration.",
    nextAction: null,
  });
}

function unknownLane(key: CollectionHealthLane["key"], label: string): CollectionHealthLane {
  return lane({
    key,
    label,
    state: "unknown",
    labelText: "Unknown",
    lastCaptureAt: null,
    lastSuccessfulCaptureAt: null,
    latestAttemptAt: null,
    detail: "The saved collection record could not be read. No count is assumed to be zero.",
    nextAction: "Check the collection read and its schema availability.",
  });
}

function noCaptureLane(key: CollectionHealthLane["key"], label: string): CollectionHealthLane {
  return lane({
    key,
    label,
    state: "no_capture",
    labelText: "No capture",
    lastCaptureAt: null,
    lastSuccessfulCaptureAt: null,
    latestAttemptAt: null,
    detail: "No saved capture is available yet.",
    nextAction: "Confirm that collection has run since this service was enabled.",
  });
}

function providerLane(input: {
  key: "twitch" | "igdb";
  label: string;
  status: string;
  capturedAt: string;
  lastSuccessfulCaptureAt: string | null;
  hasInvalidSuccessHistory?: boolean;
  complete?: boolean | null;
  health: CollectionHealthInput;
}): CollectionHealthLane {
  const status = input.status;
  const capturedTime = timeOf(input.capturedAt);
  const now = input.health.now.getTime();
  const latestAttemptAt = capturedTime !== null && Number.isFinite(now) && capturedTime <= now ? input.capturedAt : null;
  const lastSuccessfulCaptureAt = input.lastSuccessfulCaptureAt;
  const capture = lastSuccessfulCaptureAt ?? latestAttemptAt;

  if (!latestAttemptAt) {
    return lane({
      key: input.key,
      label: input.label,
      state: "unknown",
      labelText: "Unknown",
      lastCaptureAt: null,
      lastSuccessfulCaptureAt: null,
      latestAttemptAt: null,
      detail: "The saved capture time is invalid.",
      nextAction: "Check the saved collection record.",
    });
  }

  if (input.hasInvalidSuccessHistory) {
    return lane({
      key: input.key,
      label: input.label,
      state: "unknown",
      labelText: "Unknown",
      lastCaptureAt: null,
      lastSuccessfulCaptureAt: null,
      latestAttemptAt,
      detail: "A saved successful-capture time is invalid.",
      nextAction: "Check the saved collection record.",
    });
  }

  if (status === "stale") {
    if (input.key === "twitch" && lastSuccessfulCaptureAt && !isDelayed(lastSuccessfulCaptureAt, PLATFORM_COLLECTION_INTERVAL_MS, input.health)) {
      return lane({
        key: input.key,
        label: input.label,
        state: "ok",
        labelText: "On schedule",
        lastCaptureAt: lastSuccessfulCaptureAt,
        lastSuccessfulCaptureAt,
        latestAttemptAt,
        detail: "The last complete capture is within the collection window. Live display freshness uses a shorter window.",
        nextAction: null,
      });
    }
    return lane({
      key: input.key,
      label: input.label,
      state: "delayed",
      labelText: "Delayed",
      lastCaptureAt: capture,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: "The latest provider capture is stale and no longer represents current data.",
      nextAction: "Check that the scheduled collector can capture this provider again.",
    });
  }

  if (status !== "ok") {
    return lane({
      key: input.key,
      label: input.label,
      state: "unavailable",
      labelText: "Provider unavailable",
      lastCaptureAt: capture,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: "The latest provider capture did not return usable data.",
      nextAction: "Check the provider configuration and the next scheduled capture.",
    });
  }

  if (isDelayed(latestAttemptAt, PLATFORM_COLLECTION_INTERVAL_MS, input.health)) {
    return lane({
      key: input.key,
      label: input.label,
      state: "delayed",
      labelText: "Delayed",
      lastCaptureAt: capture,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: "The latest provider metadata is older than the configured collection window.",
      nextAction: "Check that the scheduled collector can run and capture this provider again.",
    });
  }

  if (input.complete !== undefined && input.complete !== true) {
    return lane({
      key: input.key,
      label: input.label,
      state: "incomplete",
      labelText: "Incomplete",
      lastCaptureAt: capture,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: input.complete === false
        ? "The latest capture is partial, so it is not a complete audience count."
        : "The latest capture has no complete audience count.",
      nextAction: "Check the provider response on the next scheduled capture.",
    });
  }

  return lane({
    key: input.key,
    label: input.label,
    state: "ok",
    labelText: "Current",
    lastCaptureAt: capture,
    lastSuccessfulCaptureAt,
    latestAttemptAt,
    detail: "The latest saved capture is within the configured collection window.",
    nextAction: null,
  });
}

export function collectionHealth(input: CollectionHealthInput): CollectionHealth {
  const steamReadFailed = input.pulseReadFailures.includes("steam");
  const platformReadFailed = input.pulseReadFailures.includes("platform");
  const steamCapture = latestCapture(input.steamPulse, input.now);
  const twitchHistory = latestCapture(input.platformContext?.twitchHistory ?? [], input.now);
  const latestSteam = steamCapture.latest;
  const latestTwitchSuccess = twitchHistory.latest;

  const steam = steamReadFailed
    ? unknownLane("steam", "Steam reviews")
    : !input.steamPulseEnabled
      ? disabledLane("steam", "Steam reviews")
      : steamCapture.hasInvalidTimestamp
        ? unknownLane("steam", "Steam reviews")
      : !latestSteam
        ? noCaptureLane("steam", "Steam reviews")
        : isDelayed(latestSteam, STEAM_COLLECTION_INTERVAL_MS, input)
          ? lane({
              key: "steam",
              label: "Steam reviews",
              state: "delayed",
              labelText: "Delayed",
              lastCaptureAt: latestSteam,
              lastSuccessfulCaptureAt: latestSteam,
              latestAttemptAt: latestSteam,
              detail: "The latest review capture is older than the collection window.",
              nextAction: "Check that the scheduled collector can run and capture Steam reviews again.",
            })
          : lane({
              key: "steam",
              label: "Steam reviews",
              state: "ok",
              labelText: "Current",
              lastCaptureAt: latestSteam,
              lastSuccessfulCaptureAt: latestSteam,
              latestAttemptAt: latestSteam,
              detail: "The latest saved review capture is within the collection window.",
              nextAction: null,
            });

  const [twitch, igdb] = platformReadFailed
    ? [unknownLane("twitch", "Twitch audience"), unknownLane("igdb", "IGDB platform metadata")]
    : !input.platformContextConfigured
      ? [disabledLane("twitch", "Twitch audience"), disabledLane("igdb", "IGDB platform metadata")]
      : !input.platformContext
        ? [noCaptureLane("twitch", "Twitch audience"), noCaptureLane("igdb", "IGDB platform metadata")]
        : [
            providerLane({
              key: "twitch",
              label: "Twitch audience",
              status: input.platformContext.twitchStatus,
              capturedAt: input.platformContext.capturedAt,
              lastSuccessfulCaptureAt: latestTwitchSuccess ?? (
                input.platformContext.twitchStatus === "ok" && input.platformContext.twitchComplete === true
                  ? input.platformContext.capturedAt
                  : null
              ),
              hasInvalidSuccessHistory: twitchHistory.hasInvalidTimestamp,
              complete: input.platformContext.twitchComplete,
              health: input,
            }),
            providerLane({
              key: "igdb",
              label: "IGDB platform metadata",
              status: input.platformContext.igdbStatus,
              capturedAt: input.platformContext.capturedAt,
              lastSuccessfulCaptureAt: input.platformContext.igdbStatus === "ok" ? input.platformContext.capturedAt : null,
              health: input,
            }),
          ];

  const lanes = [steam, twitch, igdb];
  const attentionCount = lanes.filter((item) => item.needsAttention).length;
  return {
    lanes,
    attentionCount,
    status: lanes.some((item) => item.state === "unknown")
      ? "unknown"
      : attentionCount > 0
        ? "attention"
        : "ok",
  };
}
