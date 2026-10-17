import { describe, expect, it, vi } from "vitest";
import { gapAtTime } from "@/lib/captureGaps";
import { normalizeSteamPlayerHistory, steamPlayerWindow } from "@/lib/steamPlayerHistory";
import { readSteamPlayerHistory } from "@/lib/steamPlayerHistory.server";

const now = new Date("2026-09-24T12:00:00Z");

describe("Steam player history", () => {
  it("keeps a real zero while discarding invalid, future, and out-of-window captures", () => {
    const points = normalizeSteamPlayerHistory([
      { captured_at: "2026-09-24T11:00:00Z", player_count: 0 },
      { captured_at: "2026-09-24T10:00:00Z", player_count: 17000 },
      { captured_at: "invalid", player_count: 5 },
      { captured_at: "2026-09-24T13:00:00Z", player_count: 5 },
      { captured_at: "2026-09-01T13:00:00Z", player_count: 5 },
      { captured_at: "2026-09-24T09:00:00Z", player_count: "55" },
    ], now);
    expect(points.map((point) => point.playerCount)).toEqual([17000, 0]);
  });

  it("anchors windows to the check time, shows single captures, and breaks collection gaps", () => {
    const history = { availability: "ready" as const, checkedAt: now.toISOString(), points: [
      { capturedAt: "2026-09-22T12:00:00Z", playerCount: 12000 },
      { capturedAt: "2026-09-24T11:00:00Z", playerCount: 17000 },
    ] };
    expect(steamPlayerWindow(history, 24).points).toHaveLength(1);
    expect(steamPlayerWindow(history, 168).segments).toHaveLength(2);
    // The gap is bridged by its two real captures only; nothing is added between them.
    expect(steamPlayerWindow(history, 168).points).toHaveLength(2);
    expect(steamPlayerWindow(history, 168).gaps).toEqual([{ from: history.points[0], to: history.points[1] }]);
    expect(steamPlayerWindow(history, 24).gaps).toEqual([]);
  });

  it("reports a gap only inside it, leaving each end capture selectable", () => {
    const from = { capturedAt: "2026-09-24T00:00:00Z", playerCount: 1 };
    const to = { capturedAt: "2026-09-24T04:00:00Z", playerCount: 2 };
    const at = (iso: string) => Date.parse(iso);
    const minute = 60_000;
    expect(gapAtTime([{ from, to }], at("2026-09-24T02:00:00Z"), 10 * minute)).toEqual({ from, to });
    expect(gapAtTime([{ from, to }], at("2026-09-24T00:05:00Z"), 10 * minute)).toBeNull();
    expect(gapAtTime([{ from, to }], at("2026-09-24T03:55:00Z"), 10 * minute)).toBeNull();
    expect(gapAtTime([{ from, to }], at("2026-09-24T05:00:00Z"), 10 * minute)).toBeNull();
    // A wide pixel allowance never swallows the whole gap: the middle half stays a target.
    expect(gapAtTime([{ from, to }], at("2026-09-24T02:00:00Z"), 600 * minute)).toEqual({ from, to });
    expect(gapAtTime([{ from, to }], at("2026-09-24T00:50:00Z"), 600 * minute)).toBeNull();
  });

  it("reads only public aggregate fields and surfaces permission failures", async () => {
    const query = { select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [{ captured_at: "2026-09-24T11:00:00Z", player_count: 0, private: "never return" }], error: null }) };
    const client = { from: vi.fn(() => query) };
    await expect(readSteamPlayerHistory(client as never, now)).resolves.toEqual({ availability: "ready", checkedAt: now.toISOString(), points: [{ capturedAt: "2026-09-24T11:00:00Z", playerCount: 0 }] });
    expect(query.select).toHaveBeenCalledWith("captured_at, player_count");
    query.limit.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(readSteamPlayerHistory(client as never, now)).rejects.toThrow("permission denied");
    query.limit.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.steam_player_snapshots' in the schema cache" } });
    await expect(readSteamPlayerHistory(client as never, now)).resolves.toMatchObject({ availability: "unavailable", points: [] });
  });
});
