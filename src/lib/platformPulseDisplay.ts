export type PlatformContextStatus = "ok" | "absent" | "unconfigured" | "malformed" | "stale" | "error";

type PlatformContextStatusInput = PlatformContextStatus | string | null | undefined;

export type ReviewDeltaTone = "positive" | "negative" | "flat";

export type SteamHistoryPoint = {
  snapshotDay: string;
  totalReviews: number;
  positivePercentage: number;
  reviewCountDelta?: number | null;
};

export type TwitchHistoryPoint = {
  capturedAt: string;
  liveStreams: number;
  liveViewers: number;
};

export type SteamHistorySummary = {
  status: "collecting" | "ready";
  windowDays: 7 | 14;
  snapshotCount: number;
  points: SteamHistoryPoint[];
  reviewChange: number | null;
  positivityChange: number | null;
};

export type TwitchHistorySummary = {
  status: "collecting" | "ready";
  snapshotCount: number;
  points: TwitchHistoryPoint[];
  currentStreams: number | null;
  currentViewers: number | null;
  peakViewers: number | null;
  lowViewers: number | null;
  viewerChange: number | null;
};

function normalizePlatformContextStatus(status: PlatformContextStatusInput): PlatformContextStatus {
  if (
    status === "ok" ||
    status === "absent" ||
    status === "unconfigured" ||
    status === "malformed" ||
    status === "stale" ||
    status === "error"
  ) {
    return status;
  }
  return "error";
}

export function isProviderStatusOk(status: PlatformContextStatusInput): boolean {
  return normalizePlatformContextStatus(status) === "ok";
}

export function formatSignedReviewDelta(delta: number | null): string {
  if (delta === null) return "—";
  const safe = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (safe === 0) return "0";
  return `${safe > 0 ? "+" : "-"}${Math.abs(safe)}`;
}

export function reviewDeltaTone(delta: number | null): ReviewDeltaTone {
  if (delta === null) return "flat";
  const safe = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (safe > 0) return "positive";
  if (safe < 0) return "negative";
  return "flat";
}

export function twitchCoverageLabel(complete: boolean | null): string {
  if (complete === true) return "Complete point-in-time count";
  if (complete === false) return "Point-in-time partial count";
  return "No Twitch count available";
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function summarizeSteamHistory(points: SteamHistoryPoint[]): SteamHistorySummary {
  const normalized = points
    .filter(
      (point) =>
        typeof point.snapshotDay === "string" &&
        point.snapshotDay.length > 0 &&
        finite(point.totalReviews) &&
        finite(point.positivePercentage),
    )
    .map((point) => ({
      snapshotDay: point.snapshotDay,
      totalReviews: point.totalReviews,
      positivePercentage: Math.min(100, Math.max(0, point.positivePercentage)),
      reviewCountDelta:
        typeof point.reviewCountDelta === "number" && finite(point.reviewCountDelta)
          ? Math.trunc(point.reviewCountDelta)
          : null,
    }))
    .sort((a, b) => a.snapshotDay.localeCompare(b.snapshotDay))
    .slice(-14);
  const first = normalized[0] ?? null;
  const latest = normalized[normalized.length - 1] ?? null;
  const ready = normalized.length >= 2 && first !== null && latest !== null;

  return {
    status: ready ? "ready" : "collecting",
    windowDays: normalized.length > 7 ? 14 : 7,
    snapshotCount: normalized.length,
    points: normalized,
    reviewChange: ready ? latest.totalReviews - first.totalReviews : null,
    positivityChange: ready ? latest.positivePercentage - first.positivePercentage : null,
  };
}

export function summarizeTwitchHistory(
  points: TwitchHistoryPoint[],
  now = new Date(),
): TwitchHistorySummary {
  const nowMs = now.getTime();
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;
  const normalized = points
    .filter((point) => {
      const capturedAt = new Date(point.capturedAt).getTime();
      return (
        Number.isFinite(capturedAt) &&
        capturedAt >= dayAgo &&
        capturedAt <= nowMs &&
        finite(point.liveStreams) &&
        finite(point.liveViewers)
      );
    })
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = normalized[0] ?? null;
  const latest = normalized[normalized.length - 1] ?? null;
  const ready = normalized.length >= 2 && first !== null && latest !== null;

  return {
    status: ready ? "ready" : "collecting",
    snapshotCount: normalized.length,
    points: normalized,
    currentStreams: latest?.liveStreams ?? null,
    currentViewers: latest?.liveViewers ?? null,
    peakViewers: ready ? Math.max(...normalized.map((point) => point.liveViewers)) : null,
    lowViewers: ready ? Math.min(...normalized.map((point) => point.liveViewers)) : null,
    viewerChange: ready ? latest.liveViewers - first.liveViewers : null,
  };
}

export function formatHistoryChange(
  value: number | null,
  unit: "reviews" | "viewers" | "points",
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "points") {
    const rounded = Math.abs(value).toFixed(1);
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${rounded} pts`;
  }
  const rounded = Math.abs(Math.trunc(value)).toLocaleString("en-US");
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${rounded}`;
}

export function canonicalIgdbUrl(slug: string | null | undefined): string | null {
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return `https://www.igdb.com/games/${slug}`;
}

export const PLATFORM_CONTEXT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function platformContextIsStale(capturedAt: string, now = new Date()): boolean {
  const capturedTime = new Date(capturedAt).getTime();
  return !Number.isFinite(capturedTime) || now.getTime() - capturedTime > PLATFORM_CONTEXT_MAX_AGE_MS;
}

export function platformUnavailableMessage(
  provider: string,
  status: PlatformContextStatusInput,
): string {
  const normalized = normalizePlatformContextStatus(status);
  if (normalized === "ok") return "";
  if (normalized === "absent") return `${provider} has no snapshot match for this check.`;
  if (normalized === "unconfigured") return `${provider} credentials are not configured.`;
  if (normalized === "malformed") return `${provider} returned malformed snapshot data.`;
  if (normalized === "stale") return `${provider} live counts are stale and have been hidden.`;
  return `${provider} request failed.`;
}
