import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { PUBLIC_DASHBOARD_TAG } from "@/lib/cacheTags";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";
import {
  buildActivityDays,
  normalizePlayerRows,
  normalizeReviewRows,
  normalizeTwitchRows,
  type ActivityHistory,
  type ActivityLane,
  type LaneState,
} from "@/lib/activityHistory";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 1000;
// Far above any real window (two captures an hour for 120 days); a guard, not a limit.
const MAX_PAGES = 8;

type Client = ReturnType<typeof createServiceClient>;
type Page = { data: unknown; error: { code?: string; message: string } | null };

class LaneUnavailable extends Error {}

/**
 * Pages forward by a strictly increasing timestamp so the API row cap cannot
 * truncate a window. A missing table is the lane's own "unavailable" state; any
 * other database failure is unavailable too, never an empty success.
 */
async function readForward(
  table: string,
  first: () => PromiseLike<Page>,
  next: (after: string) => PromiseLike<Page>,
  cursor: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let page = await first();
  for (let count = 0; count < MAX_PAGES; count += 1) {
    if (page.error) {
      if (isMissingSupabaseRelation(page.error, table)) throw new LaneUnavailable(`${table} is not available yet`);
      throw new LaneUnavailable(`${table} read failed: ${page.error.message}`);
    }
    const pageRows = (page.data ?? []) as Record<string, unknown>[];
    rows.push(...pageRows);
    const last = pageRows.at(-1)?.[cursor];
    if (pageRows.length < PAGE_SIZE || typeof last !== "string") return rows;
    page = await next(last);
  }
  return rows;
}

async function lane<T>(read: () => Promise<T[]>): Promise<{ rows: T[]; state: LaneState }> {
  try {
    const rows = await read();
    return { rows, state: rows.length ? "ready" : "empty" };
  } catch {
    return { rows: [], state: "unavailable" };
  }
}

/** Reads only public aggregate columns: capture times, counts and Steam's own totals. */
export async function readActivityHistory(supabase: Client, now = new Date(), windowDays = 90): Promise<ActivityHistory> {
  const to = now.getTime();
  const from = Date.parse(`${new Date(to - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`);
  const since = new Date(from).toISOString();
  const [players, twitch, reviews] = await Promise.all([
    lane(async () => normalizePlayerRows(await readForward(
      "steam_player_snapshots",
      () => supabase.from("steam_player_snapshots").select("captured_at, player_count")
        .gte("captured_at", since).order("captured_at", { ascending: true }).limit(PAGE_SIZE),
      (after) => supabase.from("steam_player_snapshots").select("captured_at, player_count")
        .gt("captured_at", after).order("captured_at", { ascending: true }).limit(PAGE_SIZE),
      "captured_at",
    ), from, to)),
    lane(async () => normalizeTwitchRows(await readForward(
      "platform_context_snapshots",
      () => supabase.from("platform_context_snapshots").select("captured_at, twitch_status, twitch_live_viewers, twitch_complete")
        .eq("twitch_status", "ok").eq("twitch_complete", true)
        .gte("captured_at", since).order("captured_at", { ascending: true }).limit(PAGE_SIZE),
      (after) => supabase.from("platform_context_snapshots").select("captured_at, twitch_status, twitch_live_viewers, twitch_complete")
        .eq("twitch_status", "ok").eq("twitch_complete", true)
        .gt("captured_at", after).order("captured_at", { ascending: true }).limit(PAGE_SIZE),
      "captured_at",
    ), from, to)),
    lane(async () => {
      // One row per day; the day before the window lets the first day show its change.
      const { data, error } = await supabase.from("steam_pulse_snapshots")
        .select("snapshot_day, total_reviews, total_positive, positive_percentage")
        .gte("snapshot_day", new Date(from - DAY_MS).toISOString().slice(0, 10))
        .order("snapshot_day", { ascending: true })
        .limit(windowDays + 2);
      if (error) throw new LaneUnavailable(error.message);
      return normalizeReviewRows((data ?? []) as Record<string, unknown>[]);
    }),
  ]);
  const lanes: Record<ActivityLane, LaneState> = { players: players.state, twitch: twitch.state, reviews: reviews.state };
  return {
    checkedAt: now.toISOString(),
    days: buildActivityDays({ from, to, players: players.rows, twitch: twitch.rows, reviews: reviews.rows }),
    playerCaptures: players.rows,
    lanes,
  };
}

function unavailableHistory(): ActivityHistory {
  return {
    checkedAt: new Date().toISOString(),
    days: [],
    playerCaptures: [],
    lanes: { players: "unavailable", twitch: "unavailable", reviews: "unavailable" },
  };
}

class PartialActivityHistory extends Error {
  constructor(readonly history: ActivityHistory) {
    super("Activity history is partly unavailable.");
  }
}

// Shared by every page rebuild for an hour, and refreshed with the other public
// data after each scan. A read with an unavailable lane is returned but never
// cached, so a short outage does not stick for the hour.
const getCachedActivityHistory = unstable_cache(async (windowDays: number) => {
  const history = await readActivityHistory(createServiceClient(), new Date(), windowDays);
  if (Object.values(history.lanes).includes("unavailable")) throw new PartialActivityHistory(history);
  return history;
}, ["public-activity-history-v1"], { revalidate: 3600, tags: [PUBLIC_DASHBOARD_TAG] });

export const getActivityHistory = cache(async (windowDays = 90): Promise<ActivityHistory> => {
  if (!hasSupabaseServiceConfig()) return unavailableHistory();
  try {
    return await getCachedActivityHistory(windowDays);
  } catch (error) {
    return error instanceof PartialActivityHistory ? error.history : unavailableHistory();
  }
});
