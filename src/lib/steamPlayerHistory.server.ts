import "server-only";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";
import { normalizeSteamPlayerHistory, type SteamPlayerHistory } from "@/lib/steamPlayerHistory";

export async function readSteamPlayerHistory(supabase: ReturnType<typeof createServiceClient>, now = new Date()): Promise<SteamPlayerHistory> {
  const checkedAt = now.toISOString();
  // One stored capture per UTC hour, including both window endpoints.
  const { data, error } = await supabase.from("steam_player_snapshots")
    .select("captured_at, player_count")
    .gte("captured_at", new Date(now.getTime() - 7 * 86400000).toISOString())
    .order("captured_at", { ascending: false }).limit(169);
  if (error) {
    if (isMissingSupabaseRelation(error, "steam_player_snapshots")) return { availability: "unavailable", checkedAt, points: [] };
    throw new Error(`Steam player history read failed: ${error.message}`);
  }
  const points = normalizeSteamPlayerHistory((data ?? []) as Record<string, unknown>[], now);
  return { availability: points.length ? "ready" : "empty", checkedAt, points };
}

export async function getSteamPlayerHistory(): Promise<SteamPlayerHistory> {
  const checkedAt = new Date().toISOString();
  if (!hasSupabaseServiceConfig()) return { availability: "unavailable", checkedAt, points: [] };
  try {
    return await readSteamPlayerHistory(createServiceClient());
  } catch {
    // Keep the other Observatory sources usable and surface this lane's failure.
    return { availability: "unavailable", checkedAt, points: [] };
  }
}
