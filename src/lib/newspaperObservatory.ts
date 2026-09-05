import { CATEGORY_LABELS } from "@/lib/constants";
import type { PlatformContextSnapshot, PublicScannerData, SteamPulsePoint } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";

export type ObservatoryAvailability = "ready" | "empty" | "unavailable";

export type SteamReviewPoint = {
  snapshotDay: string;
  collectedAt: string;
  totalReviews: number;
  positivePercentage: number;
  totalPositive: number | null;
  totalNegative: number | null;
  reviewMovement: number | null;
  positiveMovement: number | null;
  negativeMovement: number | null;
};

export type SteamReviewSeries = {
  availability: ObservatoryAvailability;
  points: SteamReviewPoint[];
};

export type TwitchPoint = {
  capturedAt: string;
  viewers: number;
  streams: number;
};

export type TwitchSeries = {
  availability: ObservatoryAvailability;
  checkedAt: string | null;
  points: TwitchPoint[];
};

export type TwitchWindow = {
  start: number;
  end: number;
  points: TwitchPoint[];
  segments: TwitchPoint[][];
};

export type RadarCategory = {
  category: string;
  label: string;
  short: string;
  tracked: number;
  newThisWeek: number;
};

function validDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function signedInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function exactSentiment(point: SteamPulsePoint): { positive: number | null; negative: number | null } {
  const positive = nonnegativeInteger(point.totalPositive);
  const negative = nonnegativeInteger(point.totalNegative);
  const total = nonnegativeInteger(point.totalReviews);
  if (positive === null || negative === null || total === null || positive + negative !== total) {
    return { positive: null, negative: null };
  }
  return { positive, negative };
}

/**
 * Converts only persisted Steam aggregates to the public chart DTO. Rounded
 * percentages never become invented positive/negative counts.
 */
export function buildSteamReviewSeries(
  points: SteamPulsePoint[],
  steamReadFailed: boolean,
): SteamReviewSeries {
  if (steamReadFailed) return { availability: "unavailable", points: [] };

  const normalized = points
    .filter(
      (point) =>
        /^\d{4}-\d{2}-\d{2}$/.test(point.snapshotDay) &&
        validDate(point.collectedAt) &&
        nonnegativeInteger(point.totalReviews) !== null &&
        typeof point.positivePercentage === "number" &&
        Number.isFinite(point.positivePercentage),
    )
    .sort((a, b) => a.snapshotDay.localeCompare(b.snapshotDay) || a.collectedAt.localeCompare(b.collectedAt))
    .slice(-14);

  const reviewPoints = normalized.map((point, index) => {
    const sentiment = exactSentiment(point);
    const previous = index > 0 ? exactSentiment(normalized[index - 1]) : null;
    return {
      snapshotDay: point.snapshotDay,
      collectedAt: point.collectedAt,
      totalReviews: Math.trunc(point.totalReviews),
      positivePercentage: Math.min(100, Math.max(0, point.positivePercentage)),
      totalPositive: sentiment.positive,
      totalNegative: sentiment.negative,
      reviewMovement: signedInteger(point.reviewCountDelta),
      positiveMovement:
        sentiment.positive !== null && previous?.positive != null ? sentiment.positive - previous.positive : null,
      negativeMovement:
        sentiment.negative !== null && previous?.negative != null ? sentiment.negative - previous.negative : null,
    };
  });

  return { availability: reviewPoints.length > 0 ? "ready" : "empty", points: reviewPoints };
}

export function selectSteamReadings(points: SteamReviewPoint[], readingCount: number): SteamReviewPoint[] {
  return points.slice(-Math.max(1, readingCount));
}

/**
 * Uses the latest platform capture as the fixed audit time. The server query
 * already limits history to 96 complete aggregate rows; this function does not
 * fill missing captures or extend a requested range with older observations.
 */
export function buildTwitchSeries(
  platformContext: PlatformContextSnapshot | null,
  platformReadFailed: boolean,
): TwitchSeries {
  if (platformReadFailed || !platformContext || platformContext.twitchStatus !== "ok" || !validDate(platformContext.capturedAt)) {
    return { availability: "unavailable", checkedAt: null, points: [] };
  }

  const end = new Date(platformContext.capturedAt).getTime();
  const points = platformContext.twitchHistory
    .filter(
      (point) =>
        validDate(point.capturedAt) &&
        new Date(point.capturedAt).getTime() <= end &&
        nonnegativeInteger(point.liveViewers) !== null &&
        nonnegativeInteger(point.liveStreams) !== null,
    )
    .map((point) => ({
      capturedAt: point.capturedAt,
      viewers: Math.trunc(point.liveViewers),
      streams: Math.trunc(point.liveStreams),
    }))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .slice(-96);

  return {
    availability: points.length > 0 ? "ready" : "empty",
    checkedAt: platformContext.capturedAt,
    points,
  };
}

const TWITCH_GAP_MS = 3.25 * 60 * 60 * 1000;

export function selectTwitchWindow(series: TwitchSeries, hours: number): TwitchWindow | null {
  if (series.checkedAt === null || !validDate(series.checkedAt)) return null;
  const end = new Date(series.checkedAt).getTime();
  const start = end - Math.max(1, hours) * 60 * 60 * 1000;
  const points = series.points.filter((point) => {
    const time = new Date(point.capturedAt).getTime();
    return time >= start && time <= end;
  });
  const segments: TwitchPoint[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || new Date(point.capturedAt).getTime() - new Date(previous.capturedAt).getTime() > TWITCH_GAP_MS) {
      segments.push([point]);
    } else {
      current.push(point);
    }
  }
  return { start, end, points, segments };
}

function shortCategoryLabel(label: string): string {
  return label
    .replace("Crashes and ", "")
    .replace("Controls and ", "")
    .replace("Graphics and ", "")
    .replace("Quests and ", "")
    .replace(" progression", "");
}

export function buildRadarCategories(radar: PatchRadarData): {
  availability: ObservatoryAvailability;
  categories: RadarCategory[];
} {
  if (!radar.connected) return { availability: "unavailable", categories: [] };
  const categories = radar.categories
    .filter(
      (bucket) =>
        typeof bucket.category === "string" &&
        nonnegativeInteger(bucket.tracked) !== null &&
        nonnegativeInteger(bucket.new7d) !== null,
    )
    .map((bucket) => {
      const label = CATEGORY_LABELS[bucket.category as keyof typeof CATEGORY_LABELS] ?? bucket.category;
      return {
        category: bucket.category,
        label,
        short: shortCategoryLabel(label),
        tracked: Math.trunc(bucket.tracked),
        newThisWeek: Math.trunc(bucket.new7d),
      };
    });
  return { availability: categories.length > 0 ? "ready" : "empty", categories };
}

export function platformLabels(data: PublicScannerData): string[] | null {
  if (data.pulseReadFailures.includes("platform") || !data.platformContext || data.platformContext.igdbStatus !== "ok") {
    return null;
  }
  return data.platformContext.platforms.length > 0 ? data.platformContext.platforms : [];
}
