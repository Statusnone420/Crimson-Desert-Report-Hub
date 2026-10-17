import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import {
  buildActivityDays,
  normalizePlayerRows,
  normalizeReviewRows,
  normalizeTwitchRows,
  reviewShare,
  rollingReviewShares,
  typicalPlayers,
  usualRangeAt,
  weeklyReviewShares,
  type ActivityDay,
} from "@/lib/activityHistory";
import { readActivityHistory } from "@/lib/activityHistory.server";

const at = (iso: string) => Date.parse(iso);

describe("activity normalization", () => {
  it("keeps real zeros and drops invalid or out-of-window player captures", () => {
    const rows = [
      { captured_at: "2026-10-02T10:00:00Z", player_count: 0 },
      { captured_at: "2026-10-01T10:00:00Z", player_count: 9000 },
      { captured_at: "2026-10-01T11:00:00Z", player_count: "9000" },
      { captured_at: "not a time", player_count: 5 },
      { captured_at: "2026-09-01T10:00:00Z", player_count: 5 },
    ];
    expect(normalizePlayerRows(rows, at("2026-09-30T00:00:00Z"), at("2026-10-03T00:00:00Z"))).toEqual([
      { capturedAt: "2026-10-01T10:00:00.000Z", playerCount: 9000 },
      { capturedAt: "2026-10-02T10:00:00.000Z", playerCount: 0 },
    ]);
  });

  it("keeps the latest complete Twitch capture in each UTC hour", () => {
    const rows = [
      { captured_at: "2026-10-01T10:05:00Z", twitch_status: "ok", twitch_complete: true, twitch_live_viewers: 100 },
      { captured_at: "2026-10-01T10:45:00Z", twitch_status: "ok", twitch_complete: true, twitch_live_viewers: 140 },
      { captured_at: "2026-10-01T11:00:00Z", twitch_status: "ok", twitch_complete: false, twitch_live_viewers: 999 },
      { captured_at: "2026-10-01T12:00:00Z", twitch_status: "error", twitch_complete: null, twitch_live_viewers: null },
    ];
    expect(normalizeTwitchRows(rows, at("2026-10-01T00:00:00Z"), at("2026-10-02T00:00:00Z"))).toEqual([
      { capturedAt: "2026-10-01T10:45:00.000Z", liveViewers: 140 },
    ]);
  });

  it("drops malformed review records", () => {
    expect(normalizeReviewRows([
      { snapshot_day: "2026-10-02", total_reviews: 110, total_positive: 90, positive_percentage: 81.8 },
      { snapshot_day: "2026-10-01", total_reviews: 100, total_positive: 82, positive_percentage: 82 },
      { snapshot_day: "2026-10-03", total_reviews: 100, total_positive: 120, positive_percentage: 120 },
      { snapshot_day: "Oct 4", total_reviews: 100, total_positive: 82, positive_percentage: 82 },
    ]).map((record) => record.day)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("daily activity", () => {
  const days = buildActivityDays({
    from: at("2026-10-01T00:00:00Z"),
    to: at("2026-10-03T23:00:00Z"),
    players: [
      { capturedAt: "2026-10-01T10:00:00.000Z", playerCount: 9000 },
      { capturedAt: "2026-10-01T14:00:00.000Z", playerCount: 15000 },
      { capturedAt: "2026-10-03T14:00:00.000Z", playerCount: 12000 },
    ],
    twitch: [{ capturedAt: "2026-10-02T10:00:00.000Z", liveViewers: 300 }, { capturedAt: "2026-10-02T11:00:00.000Z", liveViewers: 100 }],
    reviews: [
      { day: "2026-10-01", totalReviews: 1000, totalPositive: 840, positivePercentage: 84 },
      { day: "2026-10-02", totalReviews: 1100, totalPositive: 920, positivePercentage: 83.6 },
    ],
  });

  it("aggregates each UTC day and leaves days without captures empty", () => {
    expect(days.map((day) => day.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days[0]).toMatchObject({ playersMin: 9000, playersMax: 15000, playersAvg: 12000, playerCaptures: 2, twitchAvg: null });
    expect(days[1]).toMatchObject({ playersAvg: null, playerCaptures: 0, twitchAvg: 200, twitchPeak: 300, twitchCaptures: 2 });
  });

  it("measures new reviews only between two recorded days", () => {
    expect(days[0]).toMatchObject({ newReviews: null, newPositive: null, totalReviews: 1000 });
    expect(days[1]).toMatchObject({ newReviews: 100, newPositive: 80, lifetimePositive: 83.6 });
    expect(days[2]).toMatchObject({ newReviews: null, totalReviews: null });
  });
});

describe("review shares", () => {
  const day = (date: string, newReviews: number | null, newPositive: number | null): ActivityDay => ({
    day: date, playersMin: null, playersMax: null, playersAvg: null, playerCaptures: 0, twitchAvg: null, twitchPeak: null,
    twitchCaptures: 0, totalReviews: null, lifetimePositive: null, newReviews, newPositive,
  });

  it("ignores days with net removals and needs enough readable days for a rolling share", () => {
    const days = [
      day("2026-10-05", 100, 80), day("2026-10-06", -5, -6), day("2026-10-07", 100, 90),
      day("2026-10-08", 100, 70), day("2026-10-09", null, null), day("2026-10-10", 100, 80), day("2026-10-11", 100, 80),
    ];
    expect(reviewShare(days)).toEqual({ positive: 400, total: 500, share: 80, days: 5 });
    const rolling = rollingReviewShares(days);
    expect(rolling.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(rolling[6]).toBe(80);
  });

  it("groups Monday-start weeks and keeps the latest ones", () => {
    const days = [day("2026-10-04", 100, 50), day("2026-10-05", 100, 80), day("2026-10-11", 100, 90), day("2026-10-12", 50, 40)];
    expect(weeklyReviewShares(days, 2).map(({ weekStart, share }) => [weekStart, share])).toEqual([
      ["2026-10-05", 85],
      ["2026-10-12", 80],
    ]);
  });
});

describe("typical players", () => {
  const capture = (iso: string, playerCount: number) => ({ capturedAt: new Date(iso).toISOString(), playerCount });

  it("takes the median of the same weekday and time in earlier weeks, averaging captures either side of the hour", () => {
    const captures = [
      capture("2026-09-26T16:00:00Z", 25368),
      capture("2026-10-03T15:00:00Z", 22346),
      capture("2026-10-03T17:00:00Z", 20353),
      capture("2026-10-10T16:00:00Z", 19529),
      capture("2026-10-17T16:00:00Z", 17333),
    ];
    expect(typicalPlayers(captures)).toEqual({ median: 21349.5, samples: 3, weekday: "Saturday" });
    expect(typicalPlayers(captures.slice(2))).toBeNull();
  });

  it("gives the usual range at a time of day from earlier captures only", () => {
    const captures = [10, 12, 14, 16, 18].map((hour, index) => capture(`2026-10-0${index + 1}T${hour === 18 ? 15 : 14}:00:00Z`, hour * 1000));
    expect(usualRangeAt(captures, at("2026-10-09T14:00:00Z"), at("2026-10-08T00:00:00Z"))).toEqual([12000, 16000]);
    expect(usualRangeAt(captures.slice(0, 3), at("2026-10-09T14:00:00Z"), at("2026-10-08T00:00:00Z"))).toBeNull();
  });
});

describe("readActivityHistory", () => {
  function fakeClient(pages: Record<string, { data: unknown; error: unknown }[]>) {
    const calls: { table: string; select: string; filters: string[] }[] = [];
    const from = (table: string) => {
      const call = { table, select: "", filters: [] as string[] };
      calls.push(call);
      const builder = {
        select(columns: string) { call.select = columns; return builder; },
        gte(column: string, value: string) { call.filters.push(`gte:${column}:${value}`); return builder; },
        gt(column: string, value: string) { call.filters.push(`gt:${column}:${value}`); return builder; },
        eq(column: string, value: unknown) { call.filters.push(`eq:${column}:${String(value)}`); return builder; },
        order() { return builder; },
        limit() { return builder; },
        then(resolve: (value: unknown) => void) {
          const queue = pages[table] ?? [{ data: [], error: null }];
          resolve(queue.length > 1 ? queue.shift() : queue[0]);
        },
      };
      return builder;
    };
    return { client: { from } as never, calls };
  }
  const now = new Date("2026-10-17T16:30:00Z");

  it("pages past the API row cap and reads only public aggregate columns", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({
      captured_at: new Date(at("2026-09-20T00:00:00Z") + index * 3_600_000).toISOString(), player_count: 10000, private: "never",
    }));
    const second = [{ captured_at: "2026-10-17T16:00:00Z", player_count: 17333 }];
    const { client, calls } = fakeClient({
      steam_player_snapshots: [{ data: first, error: null }, { data: second, error: null }],
      steam_pulse_snapshots: [{ data: [{ snapshot_day: "2026-10-17", total_reviews: 177280, total_positive: 148000, positive_percentage: 83.7 }], error: null }],
    });
    const history = await readActivityHistory(client, now, 28);
    expect(history.lanes).toEqual({ players: "ready", twitch: "empty", reviews: "ready" });
    expect(history.playerCaptures.at(-1)).toEqual({ capturedAt: "2026-10-17T16:00:00.000Z", playerCount: 17333 });
    expect(history.playerCaptures.every((capture) => Date.parse(capture.capturedAt) >= at("2026-09-20T00:00:00Z"))).toBe(true);
    expect(history.days).toHaveLength(28);
    const playerCalls = calls.filter((call) => call.table === "steam_player_snapshots");
    expect(playerCalls).toHaveLength(2);
    expect(playerCalls[1].filters).toContain(`gt:captured_at:${first.at(-1)!.captured_at}`);
    expect(new Set(calls.map((call) => call.select))).toEqual(new Set([
      "captured_at, player_count",
      "captured_at, twitch_status, twitch_live_viewers, twitch_complete",
      "snapshot_day, total_reviews, total_positive, positive_percentage",
    ]));
  });

  it("marks a failed or missing lane unavailable instead of empty", async () => {
    const { client } = fakeClient({
      steam_player_snapshots: [{ data: null, error: { code: "42501", message: "permission denied" } }],
      platform_context_snapshots: [{ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.platform_context_snapshots' in the schema cache" } }],
    });
    const history = await readActivityHistory(client, now, 7);
    expect(history.lanes).toEqual({ players: "unavailable", twitch: "unavailable", reviews: "empty" });
    expect(history.days.every((day) => day.playersAvg === null && day.twitchAvg === null)).toBe(true);
  });
});
