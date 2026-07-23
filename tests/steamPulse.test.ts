import { describe, expect, it, vi } from "vitest";
import {
  buildSteamPulseSnapshot,
  fetchSteamReviewBatch,
  filterNewOrUpdatedSteamReviews,
} from "@/lib/automation/steam";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Steam review intake", () => {
  it("uses the keyless updated-review endpoint and emits privacy-bounded candidates", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      void input;
      return response({
        success: 1,
        cursor: "next cursor",
        query_summary: { total_reviews: 42, total_positive: 30, total_negative: 12 },
        reviews: [{
          recommendationid: "123456789",
          review: "Crashes every time I open the map.",
          timestamp_created: 1_789_000_000,
          timestamp_updated: 1_789_000_100,
          voted_up: false,
          author: {
            steamid: "76561198000000000",
            personaname: "private reviewer",
            playtime_at_review: 125,
          },
        }],
      });
    });

    const batch = await fetchSteamReviewBatch({ fetchImpl, cursor: "*", dayRange: 7 });
    const requested = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requested.pathname).toBe("/appreviews/3321460");
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      json: "1",
      filter: "updated",
      language: "all",
      day_range: "7",
      cursor: "*",
      num_per_page: "100",
    });
    expect(batch.totals).toEqual({ totalReviews: 42, totalPositive: 30, totalNegative: 12 });
    expect(batch.reviews).toEqual([expect.objectContaining({
      reviewText: "Crashes every time I open the map.",
      votedUp: false,
      playtimeAtReviewMinutes: 125,
    })]);
    expect(batch.reviews[0].recommendationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(batch)).not.toContain("76561198000000000");
    expect(JSON.stringify(batch)).not.toContain("private reviewer");
    expect(JSON.stringify(batch)).not.toContain("123456789");
  });

  it("keeps first-page totals when a cursor page omits query_summary", async () => {
    const firstPageTotals = { totalReviews: 42, totalPositive: 30, totalNegative: 12 };
    const batch = await fetchSteamReviewBatch({
      cursor: "next cursor",
      fallbackTotals: firstPageTotals,
      fetchImpl: async () => response({
        success: 1,
        cursor: null,
        reviews: [{
          recommendationid: "cursor-review",
          review: "Crashes every time I open the map.",
          timestamp_created: 1_789_000_000,
          timestamp_updated: 1_789_000_100,
          voted_up: false,
        }],
      }),
    });

    expect(batch.totals).toEqual(firstPageTotals);
    expect(batch.reviews).toHaveLength(1);
    expect(batch.cursor).toBeNull();
  });

  it("rejects malformed and failed responses", async () => {
    await expect(fetchSteamReviewBatch({ fetchImpl: async () => response({ success: 0 }) })).rejects.toThrow(
      "malformed",
    );
    await expect(fetchSteamReviewBatch({ fetchImpl: async () => response({}, 503) })).rejects.toThrow("503");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => response({ success: 1, reviews: [] }),
    })).rejects.toThrow("query_summary");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => response({
        success: 1,
        reviews: [],
        query_summary: { total_reviews: 42, total_positive: "unknown", total_negative: 12 },
      }),
    })).rejects.toThrow("total_positive");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => response({
        success: 1,
        reviews: [],
        query_summary: { total_reviews: null, total_positive: 30, total_negative: 12 },
      }),
    })).rejects.toThrow("total_reviews");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => response({
        success: 1,
        reviews: [],
        query_summary: { total_reviews: 42, total_positive: 30, total_negative: false },
      }),
    })).rejects.toThrow("total_negative");
  });

  it("does not coerce non-numeric review timestamps or playtime", async () => {
    const coercibleValues = [true, false, "1789000000", []];
    const reviews = [
      ...coercibleValues.map((value, index) => ({
        recommendationid: `invalid-time-${index}`,
        review: "Invalid timestamp should stay private.",
        timestamp_created: value,
        timestamp_updated: 1_789_000_100,
        voted_up: false,
        author: { playtime_at_review: 125 },
      })),
      ...coercibleValues.map((value, index) => ({
        recommendationid: `invalid-playtime-${index}`,
        review: "Valid review with unknown playtime.",
        timestamp_created: 1_789_000_000,
        timestamp_updated: 1_789_000_100,
        voted_up: false,
        author: { playtime_at_review: value },
      })),
    ];

    const batch = await fetchSteamReviewBatch({
      fetchImpl: async () => response({
        success: 1,
        cursor: "next",
        query_summary: { total_reviews: 8, total_positive: 0, total_negative: 8 },
        reviews,
      }),
    });

    expect(batch.reviews).toHaveLength(4);
    expect(batch.reviews.every((review) => review.playtimeAtReviewMinutes === null)).toBe(true);
  });

  it("reprocesses an edited review but skips an unchanged receipt", () => {
    const reviews = [
      {
        recommendationHash: "a".repeat(64),
        reviewText: "old",
        sourceCreatedAt: "2026-07-20T10:00:00.000Z",
        sourceUpdatedAt: "2026-07-20T11:00:00.000Z",
        votedUp: false,
        playtimeAtReviewMinutes: 10,
      },
      {
        recommendationHash: "b".repeat(64),
        reviewText: "edited",
        sourceCreatedAt: "2026-07-20T10:00:00.000Z",
        sourceUpdatedAt: "2026-07-20T12:00:00.000Z",
        votedUp: false,
        playtimeAtReviewMinutes: 20,
      },
    ];
    const existing = new Map([
      ["a".repeat(64), "2026-07-20T11:00:00.000Z"],
      ["b".repeat(64), "2026-07-20T11:00:00.000Z"],
    ]);
    expect(filterNewOrUpdatedSteamReviews(reviews, existing).map((review) => review.recommendationHash)).toEqual([
      "b".repeat(64),
    ]);
  });

  it("builds a neutral daily pulse without turning reviews into report counts", () => {
    expect(buildSteamPulseSnapshot({
      batch: {
        reviews: [],
        totals: { totalReviews: 80, totalPositive: 60, totalNegative: 20 },
        cursor: null,
      },
      previousTotalReviews: 75,
      reviewsScanned: 7,
      issueLanguageCount: 3,
      leadsRetained: 2,
      now: new Date("2026-07-22T15:00:00.000Z"),
    })).toEqual({
      snapshot_day: "2026-07-22",
      collected_at: "2026-07-22T15:00:00.000Z",
      total_reviews: 80,
      total_positive: 60,
      total_negative: 20,
      positive_percentage: 75,
      review_count_delta: 5,
      reviews_scanned: 7,
      issue_language_count: 3,
      leads_retained: 2,
    });
  });

  it("keeps the first daily comparison unknown until a prior-day baseline exists", () => {
    expect(buildSteamPulseSnapshot({
      batch: {
        reviews: [],
        totals: { totalReviews: 80, totalPositive: 60, totalNegative: 20 },
        cursor: null,
      },
      previousTotalReviews: null,
      reviewsScanned: 0,
      issueLanguageCount: 0,
      leadsRetained: 0,
      now: new Date("2026-07-22T15:00:00.000Z"),
    }).review_count_delta).toBeNull();
  });
});
