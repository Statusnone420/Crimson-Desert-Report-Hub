import { captureGaps } from "@/lib/captureGaps";

export type SteamPlayerPoint = { capturedAt: string; playerCount: number };
export type SteamPlayerHistory = {
  availability: "ready" | "empty" | "unavailable";
  checkedAt: string;
  points: SteamPlayerPoint[];
};

export function normalizeSteamPlayerHistory(rows: Record<string, unknown>[], now: Date): SteamPlayerPoint[] {
  const end = now.getTime();
  const start = end - 7 * 86400000;
  return rows.flatMap((row) => {
    const capturedAt = typeof row.captured_at === "string" ? row.captured_at : "";
    const time = Date.parse(capturedAt);
    const playerCount = row.player_count;
    return Number.isFinite(time) && time >= start && time <= end && typeof playerCount === "number" && Number.isSafeInteger(playerCount) && playerCount >= 0
      ? [{ capturedAt, playerCount }] : [];
  }).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

export function steamPlayerWindow(history: SteamPlayerHistory, hours: number) {
  const end = Date.parse(history.checkedAt);
  const start = end - hours * 3600000;
  const points = history.points.filter((point) => Date.parse(point.capturedAt) >= start && Date.parse(point.capturedAt) <= end);
  const segments: SteamPlayerPoint[][] = [];
  for (const point of points) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!previous || Date.parse(point.capturedAt) - Date.parse(previous.capturedAt) > 3.25 * 3600000) segments.push([point]);
    else segment!.push(point);
  }
  return { start, end, points, segments, gaps: captureGaps(segments) };
}
