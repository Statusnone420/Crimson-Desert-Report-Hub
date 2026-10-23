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

/** GetAppReviews wraps its answer in `response` and has no `success` field. */
function reviewsPage(payload: Record<string, unknown>): Response {
  return response({ response: payload });
}

describe("Steam review intake", () => {
  it("names an HTML answer instead of surfacing a JSON parse error", async () => {
    // What the retired appreviews URL returns since 22 October 2026: the store home page, status 200.
    const html = new Response("<!DOCTYPE html><html><head><title>Welcome to Steam</title></head></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
    await expect(fetchSteamReviewBatch({ fetchImpl: async () => html })).rejects.toThrow("Steam reviews response was not JSON");
  });

  it("uses the keyless updated-review endpoint and emits privacy-bounded candidates", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      void input;
      return reviewsPage({
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

    const batch = await fetchSteamReviewBatch({ fetchImpl, cursor: "*" });
    const requested = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requested.origin + requested.pathname).toBe("https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/");
    expect([...requested.searchParams.keys()]).toEqual(["input_json"]);
    expect(JSON.parse(requested.searchParams.get("input_json")!)).toEqual({
      appid: 3321460,
      filter: 2,
      languages: ["all"],
      cursor: "*",
      review_type: 0,
      purchase_type: 1,
      num_per_page: 100,
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

  it("hashes a numeric review id the same as its string form and drops inexact ones", async () => {
    const page = (recommendationid: unknown) => async () => reviewsPage({
      cursor: null,
      query_summary: { total_reviews: 1, total_positive: 0, total_negative: 1 },
      reviews: [{
        recommendationid,
        review: "Crashes every time I open the map.",
        timestamp_created: 1_789_000_000,
        timestamp_updated: 1_789_000_100,
        voted_up: false,
      }],
    });
    const asString = await fetchSteamReviewBatch({ fetchImpl: page("123456789") });
    const asNumber = await fetchSteamReviewBatch({ fetchImpl: page(123456789) });
    expect(asNumber.reviews[0].recommendationHash).toBe(asString.reviews[0].recommendationHash);
    expect((await fetchSteamReviewBatch({ fetchImpl: page(2 ** 60) })).reviews).toEqual([]);
  });

  it("keeps first-page totals when a cursor page omits query_summary", async () => {
    const firstPageTotals = { totalReviews: 42, totalPositive: 30, totalNegative: 12 };
    const batch = await fetchSteamReviewBatch({
      cursor: "next cursor",
      fallbackTotals: firstPageTotals,
      fetchImpl: async () => reviewsPage({
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

  it("keeps first-page totals when a cursor page returns only num_reviews", async () => {
    const firstPageTotals = { totalReviews: 42, totalPositive: 30, totalNegative: 12 };
    const batch = await fetchSteamReviewBatch({
      cursor: "next cursor",
      fallbackTotals: firstPageTotals,
      fetchImpl: async () => reviewsPage({
        cursor: null,
        query_summary: { num_reviews: 1 },
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
    // An unknown app answers with an empty `response`.
    await expect(fetchSteamReviewBatch({ fetchImpl: async () => response({ response: {} }) })).rejects.toThrow(
      "malformed",
    );
    // The retired endpoint's bare shape is not accepted as a page.
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => response({ success: 1, reviews: [], query_summary: { total_reviews: 1, total_positive: 1, total_negative: 0 } }),
    })).rejects.toThrow("malformed");
    await expect(fetchSteamReviewBatch({ fetchImpl: async () => response({}, 503) })).rejects.toThrow("503");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => reviewsPage({ reviews: [] }),
    })).rejects.toThrow("query_summary");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => reviewsPage({
        reviews: [],
        query_summary: { total_reviews: 42, total_positive: "unknown", total_negative: 12 },
      }),
    })).rejects.toThrow("total_positive");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => reviewsPage({
        reviews: [],
        query_summary: { total_reviews: null, total_positive: 30, total_negative: 12 },
      }),
    })).rejects.toThrow("total_reviews");
    await expect(fetchSteamReviewBatch({
      fetchImpl: async () => reviewsPage({
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
      fetchImpl: async () => reviewsPage({
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
