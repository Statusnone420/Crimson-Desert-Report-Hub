import { externalIdHash } from "@/lib/crypto";

export const CRIMSON_DESERT_STEAM_APP_ID = "3321460";
export const STEAM_REVIEW_SOURCE_URL =
  `https://store.steampowered.com/app/${CRIMSON_DESERT_STEAM_APP_ID}/Crimson_Desert/#app_reviews_hash`;
const STEAM_REVIEW_API_URL = `https://store.steampowered.com/appreviews/${CRIMSON_DESERT_STEAM_APP_ID}`;
const MAX_REVIEWS_PER_FETCH = 100;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SteamReviewCandidate = {
  recommendationHash: string;
  reviewText: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  votedUp: boolean;
  playtimeAtReviewMinutes: number | null;
};

export type SteamReviewTotals = {
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
};

export type SteamReviewBatch = {
  reviews: SteamReviewCandidate[];
  totals: SteamReviewTotals;
  cursor: string | null;
};

type SteamApiReview = {
  recommendationid?: unknown;
  review?: unknown;
  timestamp_created?: unknown;
  timestamp_updated?: unknown;
  voted_up?: unknown;
  author?: { playtime_at_review?: unknown } | null;
};

type SteamApiResponse = {
  success?: unknown;
  cursor?: unknown;
  query_summary?: {
    total_reviews?: unknown;
    total_positive?: unknown;
    total_negative?: unknown;
  } | null;
  reviews?: unknown;
};

function requiredNonnegativeCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Steam reviews response was malformed (${field})`);
  }
  return value;
}

function unixSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseReview(value: unknown): SteamReviewCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as SteamApiReview;
  const recommendationId = typeof row.recommendationid === "string" ? row.recommendationid.trim() : "";
  const reviewText = typeof row.review === "string" ? row.review.trim() : "";
  const sourceCreatedAt = unixSecondsToIso(row.timestamp_created);
  const sourceUpdatedAt = unixSecondsToIso(row.timestamp_updated) ?? sourceCreatedAt;
  if (!recommendationId || !reviewText || !sourceCreatedAt || !sourceUpdatedAt || typeof row.voted_up !== "boolean") {
    return null;
  }

  const playtime = row.author?.playtime_at_review;
  return {
    recommendationHash: externalIdHash("steam_review", recommendationId),
    reviewText: reviewText.slice(0, 8_000),
    sourceCreatedAt,
    sourceUpdatedAt,
    votedUp: row.voted_up,
    playtimeAtReviewMinutes:
      typeof playtime === "number" && Number.isFinite(playtime) && playtime >= 0
        ? Math.round(playtime)
        : null,
  };
}

export async function fetchSteamReviewBatch({
  cursor = "*",
  dayRange = 14,
  fetchImpl = fetch,
}: {
  cursor?: string;
  dayRange?: number;
  fetchImpl?: FetchLike;
} = {}): Promise<SteamReviewBatch> {
  const url = new URL(STEAM_REVIEW_API_URL);
  url.searchParams.set("json", "1");
  url.searchParams.set("filter", "updated");
  url.searchParams.set("language", "all");
  url.searchParams.set("day_range", String(Math.max(1, Math.min(365, Math.floor(dayRange)))));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("review_type", "all");
  url.searchParams.set("purchase_type", "all");
  url.searchParams.set("num_per_page", String(MAX_REVIEWS_PER_FETCH));

  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Steam reviews request failed (${response.status})`);

  const payload = (await response.json()) as SteamApiResponse;
  if (payload.success !== 1 || !Array.isArray(payload.reviews)) {
    throw new Error("Steam reviews response was malformed");
  }

  const reviews = payload.reviews
    .map(parseReview)
    .filter((review): review is SteamReviewCandidate => review !== null);
  const query = payload.query_summary;
  if (!query || typeof query !== "object") {
    throw new Error("Steam reviews response was malformed (query_summary)");
  }
  const totalReviews = requiredNonnegativeCount(query.total_reviews, "total_reviews");
  const totalPositive = requiredNonnegativeCount(query.total_positive, "total_positive");
  const totalNegative = requiredNonnegativeCount(query.total_negative, "total_negative");
  if (totalPositive + totalNegative > totalReviews) {
    throw new Error("Steam reviews response was malformed (review totals)");
  }
  return {
    reviews,
    totals: {
      totalReviews,
      totalPositive,
      totalNegative,
    },
    cursor: typeof payload.cursor === "string" && payload.cursor ? payload.cursor : null,
  };
}

export function filterNewOrUpdatedSteamReviews(
  reviews: SteamReviewCandidate[],
  existingUpdatedAtByHash: ReadonlyMap<string, string>,
): SteamReviewCandidate[] {
  return reviews.filter((review) => {
    const existing = existingUpdatedAtByHash.get(review.recommendationHash);
    if (!existing) return true;
    const existingTime = new Date(existing).getTime();
    const sourceTime = new Date(review.sourceUpdatedAt).getTime();
    return !Number.isFinite(existingTime) || !Number.isFinite(sourceTime) || sourceTime > existingTime;
  });
}

export type SteamPulseSnapshot = {
  snapshot_day: string;
  collected_at: string;
  total_reviews: number;
  total_positive: number;
  total_negative: number;
  positive_percentage: number;
  review_count_delta: number | null;
  reviews_scanned: number;
  issue_language_count: number;
  leads_retained: number;
};

export function buildSteamPulseSnapshot({
  batch,
  previousTotalReviews,
  reviewsScanned,
  issueLanguageCount,
  leadsRetained,
  now,
}: {
  batch: SteamReviewBatch;
  previousTotalReviews: number | null;
  reviewsScanned: number;
  issueLanguageCount: number;
  leadsRetained: number;
  now: Date;
}): SteamPulseSnapshot {
  const { totalReviews, totalPositive, totalNegative } = batch.totals;
  return {
    snapshot_day: now.toISOString().slice(0, 10),
    collected_at: now.toISOString(),
    total_reviews: totalReviews,
    total_positive: totalPositive,
    total_negative: totalNegative,
    positive_percentage: totalReviews > 0 ? Number(((totalPositive / totalReviews) * 100).toFixed(1)) : 0,
    review_count_delta: previousTotalReviews === null ? null : totalReviews - previousTotalReviews,
    reviews_scanned: Math.max(0, Math.floor(reviewsScanned)),
    issue_language_count: Math.max(0, Math.floor(issueLanguageCount)),
    leads_retained: Math.max(0, Math.floor(leadsRetained)),
  };
}
