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

function durationLabel(durationMs: number): string {
  const minutes = Math.round(durationMs / (60 * 1000));
  if (minutes === 60) return "1 hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function collectionWindowDetail(
  provider: "steam" | "platform",
  input: CollectionHealthInput,
): string {
  const interval = provider === "steam" ? STEAM_COLLECTION_INTERVAL_MS : PLATFORM_COLLECTION_INTERVAL_MS;
  const intervalLabel = provider === "steam" ? "6-hour Steam review collection interval" : "1-hour platform collection interval";
  const scannerCadence = `${Math.round(cadenceMs(input.scheduledCadenceMinutes) / (60 * 1000))}-minute`;
  const maximumAge = durationLabel(interval + cadenceMs(input.scheduledCadenceMinutes));
  return `The collection schedule allows a ${intervalLabel} plus the configured ${scannerCadence} scanner cadence (${maximumAge} maximum age).`;
}

function twitchLiveDisplayDetail(): string {
  return "Twitch live-display counts use a separate 2-hour freshness limit.";
}

/**
 * A capture can occur only after its own minimum interval and the next scanner
 * run. This grace includes the configured scanner cadence after that interval.
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

function unreadableRecordLane(key: CollectionHealthLane["key"], label: string): CollectionHealthLane {
  return lane({
    key,
    label,
    state: "unknown",
    labelText: "Saved record unreadable",
    lastCaptureAt: null,
    lastSuccessfulCaptureAt: null,
    latestAttemptAt: null,
    detail: "The saved collection record could not be read. Its capture status and any count are unverified.",
    nextAction: "Restore the saved-record read, then check the next scheduled collection.",
  });
}

function invalidTimestampLane(input: {
  key: CollectionHealthLane["key"];
  label: string;
  lastSuccessfulCaptureAt?: string | null;
  latestAttemptAt?: string | null;
}): CollectionHealthLane {
  return lane({
    key: input.key,
    label: input.label,
    state: "unknown",
    labelText: "Invalid saved timestamp",
    lastCaptureAt: null,
    lastSuccessfulCaptureAt: input.lastSuccessfulCaptureAt ?? null,
    latestAttemptAt: input.latestAttemptAt ?? null,
    detail: "A saved capture timestamp is invalid or in the future. Collection freshness cannot be verified.",
    nextAction: "Correct the saved record, then check the next scheduled collection.",
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
    detail: "No saved capture is available yet. This does not establish a zero count.",
    nextAction: "Confirm collection has run since this service was enabled; inspect the next scheduled attempt if no capture appears.",
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
    return invalidTimestampLane({
      key: input.key,
      label: input.label,
      lastSuccessfulCaptureAt,
    });
  }

  if (input.hasInvalidSuccessHistory) {
    return invalidTimestampLane({
      key: input.key,
      label: input.label,
      latestAttemptAt,
      lastSuccessfulCaptureAt,
    });
  }

  if (status !== "ok" && status !== "stale") {
    return lane({
      key: input.key,
      label: input.label,
      state: "unavailable",
      labelText: "Provider unavailable",
      lastCaptureAt: capture,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: `The latest saved provider response is marked ${status || "unavailable"}. No more specific cause is recorded.`,
      nextAction: "Inspect the saved response, then check the next scheduled capture.",
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
      detail: `${collectionWindowDetail("platform", input.health)} The latest saved capture is older than that window.`,
      nextAction: "Check that the scheduled collector can run, then inspect the next provider capture.",
    });
  }

  if (status === "stale" && lastSuccessfulCaptureAt && !isDelayed(lastSuccessfulCaptureAt, PLATFORM_COLLECTION_INTERVAL_MS, input.health)) {
    return lane({
      key: input.key,
      label: input.label,
      state: "ok",
      labelText: "On schedule",
      lastCaptureAt: lastSuccessfulCaptureAt,
      lastSuccessfulCaptureAt,
      latestAttemptAt,
      detail: `${collectionWindowDetail("platform", input.health)}${input.key === "twitch" ? ` ${twitchLiveDisplayDetail()}` : ""}`,
      nextAction: null,
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
    labelText: status === "stale" ? "On schedule" : "Current",
    lastCaptureAt: capture,
    lastSuccessfulCaptureAt,
    latestAttemptAt,
    detail: status === "stale"
      ? `${collectionWindowDetail("platform", input.health)} ${input.key === "twitch" ? twitchLiveDisplayDetail() : ""}`.trim()
      : `${collectionWindowDetail("platform", input.health)}${input.key === "twitch" ? ` ${twitchLiveDisplayDetail()}` : ""}`,
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
    ? unreadableRecordLane("steam", "Steam reviews")
    : !input.steamPulseEnabled
      ? disabledLane("steam", "Steam reviews")
      : steamCapture.hasInvalidTimestamp
        ? invalidTimestampLane({
            key: "steam",
            label: "Steam reviews",
            lastSuccessfulCaptureAt: latestSteam,
          })
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
              detail: `${collectionWindowDetail("steam", input)} The latest saved capture is older than that window.`,
              nextAction: "Check that the scheduled collector can run, then inspect the next Steam review capture.",
            })
          : lane({
              key: "steam",
              label: "Steam reviews",
              state: "ok",
              labelText: "Current",
              lastCaptureAt: latestSteam,
              lastSuccessfulCaptureAt: latestSteam,
              latestAttemptAt: latestSteam,
              detail: collectionWindowDetail("steam", input),
              nextAction: null,
            });

  const [twitch, igdb] = platformReadFailed
    ? [unreadableRecordLane("twitch", "Twitch audience"), unreadableRecordLane("igdb", "IGDB platform metadata")]
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
