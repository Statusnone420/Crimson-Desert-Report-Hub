import "server-only";
import { currentScannerExecution, scannerSourceFetch } from "./executionContext.server";
import { blocksScheduledScan, type RecentRunLike } from "./schedule";
import { fetchSteamCurrentPlayers } from "./steam";
import { platformContextConfigured, steamPlayerCountsEnabled } from "@/lib/env";
import { fetchCrimsonDesertPlatformContext } from "@/lib/platform/igdb";
import type { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";

type Client = ReturnType<typeof createServiceClient>;
/** A run result or a skipped wake's record. Captures add codes and errors, and turn success into partial. */
export type CaptureLedger = { status: "success" | "partial" | "failed" | "skipped"; skips: string[]; errors: string[] };

const PLATFORM_CONTEXT_INTERVAL_MS = 60 * 60 * 1000;
const STEAM_PLAYER_INTERVAL_MS = 60 * 60 * 1000;
// Waits before each retry of a failed free fetch. The run's work window is 220
// seconds, so these are seconds, not minutes; a source that still fails is
// captured by the next hourly wake instead (captureMissedContextSnapshots).
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
// No retry starts this close to the work deadline, so a slow last attempt
// cannot push the run's own bookkeeping past its deadline.
const RETRY_RESERVE_MS = 60_000;
// Capture stamps come from the function clock and run starts from the
// database, so a capture this close to a run's start counts as that run's.
const RUN_START_TOLERANCE_MS = 5 * 60 * 1000;

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function fetchWithRetries<T>(
  fetchOnce: () => Promise<T>,
  failed: (value: T) => boolean,
  ledger: CaptureLedger,
  retryCode: string,
): Promise<T> {
  let value = await fetchOnce();
  for (const delayMs of RETRY_DELAYS_MS) {
    const deadlineAtMs = currentScannerExecution()?.workDeadlineAtMs;
    if (!failed(value) || deadlineAtMs === undefined || Date.now() + delayMs > deadlineAtMs - RETRY_RESERVE_MS) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    ledger.skips.push(retryCode);
    value = await fetchOnce();
  }
  return value;
}

async function persistSteamPlayerSnapshot(
  supabase: Client,
  result: CaptureLedger,
  now: Date,
  capturedSince?: number,
): Promise<void> {
  if (!steamPlayerCountsEnabled()) return;
  try {
    const { data, error } = await supabase.from("steam_player_snapshots")
      .select("captured_at").order("captured_at", { ascending: false }).limit(1);
    if (error) {
      if (isMissingSupabaseRelation(error, "steam_player_snapshots")) {
        result.skips.push("steam_players_schema_unavailable");
        return;
      }
      throw new Error(`Steam player recency read failed: ${error.message}`);
    }
    const recent = (data ?? [])[0] as { captured_at: string } | undefined;
    if (recent && capturedSince !== undefined && Date.parse(recent.captured_at) >= capturedSince) return;
    if (recent && now.getTime() - Date.parse(recent.captured_at) < STEAM_PLAYER_INTERVAL_MS) {
      result.skips.push("steam_players_recent");
      return;
    }
    const outcome = await fetchWithRetries(
      () => fetchSteamCurrentPlayers({ fetchImpl: scannerSourceFetch() })
        .then((reading) => ({ reading }), (error: unknown) => ({ error })),
      (attempt) => "error" in attempt,
      result,
      "steam_players_retry",
    );
    if ("error" in outcome) throw outcome.error;
    const reading = outcome.reading;
    const hour = new Date(reading.capturedAt);
    hour.setUTCMinutes(0, 0, 0);
    // Keep the first successful reading in an hour if overlapping runs race.
    const { error: writeError } = await supabase.from("steam_player_snapshots").upsert({
      sample_hour: hour.toISOString(),
      captured_at: reading.capturedAt,
      player_count: reading.playerCount,
    }, { onConflict: "sample_hour", ignoreDuplicates: true });
    if (writeError) {
      if (isMissingSupabaseRelation(writeError, "steam_player_snapshots")) {
        result.skips.push("steam_players_schema_unavailable");
        return;
      }
      throw new Error(`Steam player snapshot write failed: ${writeError.message}`);
    }
  } catch (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Steam player collection failed"));
    result.skips.push("steam_players_failed");
  }
}

async function persistPlatformContextSnapshot(
  supabase: Client,
  result: CaptureLedger,
  now: Date,
  capturedSince?: number,
): Promise<void> {
  if (!platformContextConfigured()) return;

  try {
    // Only a capture where Twitch answered counts as recent. A stored failure
    // must not stop the next run or wake from trying again.
    const { data: recentRows, error: recentError } = await supabase
      .from("platform_context_snapshots")
      .select("captured_at")
      .in("twitch_status", ["ok", "absent"])
      .order("captured_at", { ascending: false })
      .limit(1);
    if (recentError) {
      if (isMissingSupabaseRelation(recentError, "platform_context_snapshots")) {
        result.skips.push("platform_context_schema_unavailable");
        return;
      }
      throw new Error(`platform context recency read failed: ${recentError.message}`);
    }
    const recent = (recentRows ?? [])[0] as { captured_at?: string | null } | undefined;
    const recentAt = recent?.captured_at ? new Date(recent.captured_at).getTime() : Number.NaN;
    if (capturedSince !== undefined && recentAt >= capturedSince) return;
    if (Number.isFinite(recentAt) && now.getTime() - recentAt < PLATFORM_CONTEXT_INTERVAL_MS) {
      result.skips.push("platform_context_recent");
      return;
    }

    // Each attempt is stamped when it runs, so a retried capture keeps its own time.
    const context = await fetchWithRetries(
      () => fetchCrimsonDesertPlatformContext({
        fetchImpl: scannerSourceFetch(),
        env: {
          TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
          TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
        },
        now: new Date(),
      }),
      (attempt) => attempt.twitch.status === "error" || attempt.twitch.status === "malformed",
      result,
      "platform_context_retry",
    );
    const igdb = context.igdb.status === "ok" ? context.igdb.data : null;
    const twitch = context.twitch.status === "ok" ? context.twitch.data : null;
    const { error } = await supabase.from("platform_context_snapshots").insert({
      captured_at: context.capturedAt,
      igdb_status: context.igdb.status,
      igdb_game_id: igdb?.id ?? null,
      igdb_name: igdb?.name ?? null,
      igdb_slug: igdb?.slug ?? null,
      igdb_summary: igdb?.summary ?? null,
      igdb_first_release_at: igdb?.firstReleaseDate ?? null,
      igdb_platforms: igdb?.platforms ?? [],
      twitch_status: context.twitch.status,
      twitch_live_streams: twitch?.liveStreamCount ?? null,
      twitch_live_viewers: twitch?.liveViewerCount ?? null,
      twitch_complete: twitch?.isComplete ?? null,
    });
    if (error) {
      if (isMissingSupabaseRelation(error, "platform_context_snapshots")) {
        result.skips.push("platform_context_schema_unavailable");
        return;
      }
      throw new Error(`platform context snapshot write failed: ${error.message}`);
    }
    if (context.igdb.status !== "ok") result.skips.push(`platform_context_igdb_${context.igdb.status}`);
    if (context.twitch.status !== "ok") result.skips.push(`platform_context_twitch_${context.twitch.status}`);
  } catch (error) {
    // The evidence scan can still finish, but an unexpected persistence failure
    // must remain visible in run health instead of disappearing as a skip.
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Platform context persistence failed"));
    result.skips.push("platform_context_failed");
  }
}

/**
 * Steam players and Twitch audiences come from free APIs. A run starts these
 * captures before any paid work and waits for them only before it finalizes.
 * Each source retries and records its own failure, so neither can stop the other
 * or the paid lane. `capturedSince` leaves a source alone when it already has a
 * capture from that time on. Never rejects.
 */
export async function captureContextSnapshots(
  supabase: Client,
  ledger: CaptureLedger,
  now: Date,
  capturedSince?: number,
): Promise<void> {
  await Promise.all([
    persistPlatformContextSnapshot(supabase, ledger, now, capturedSince),
    persistSteamPlayerSnapshot(supabase, ledger, now, capturedSince),
  ]);
}

/**
 * A wake skipped as `recent_run` captures any source the latest run missed: one
 * whose newest capture predates that run's start. A run that captured keeps its
 * cadence, so a successful scan never adds an extra reading. Never rejects.
 */
export async function captureMissedContextSnapshots(
  supabase: Client,
  recentRuns: RecentRunLike[],
  now: Date,
): Promise<Pick<CaptureLedger, "skips" | "errors">> {
  const latestRunAt = Math.max(...recentRuns.filter(blocksScheduledScan)
    .map((run) => Date.parse(run.started_at ?? "")).filter(Number.isFinite));
  const ledger: CaptureLedger = { status: "skipped", skips: [], errors: [] };
  if (Number.isFinite(latestRunAt)) await captureContextSnapshots(supabase, ledger, now, latestRunAt - RUN_START_TOLERANCE_MS);
  return { skips: ledger.skips, errors: ledger.errors };
}
