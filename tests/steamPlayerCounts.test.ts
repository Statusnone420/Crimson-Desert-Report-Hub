import { describe, expect, it, vi } from "vitest";
import { fetchSteamCurrentPlayers } from "@/lib/automation/steam";

describe("Steam concurrent player counts", () => {
  it("uses the keyless public endpoint and returns only a completed timestamp and aggregate", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ response: { result: 1, player_count: 12345, extra: "discard" } }));
    const result = await fetchSteamCurrentPlayers({ fetchImpl, clock: () => new Date("2026-09-05T18:40:02Z") });
    expect(result).toEqual({ capturedAt: "2026-09-05T18:40:02.000Z", playerCount: 12345 });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=3321460"),
      expect.objectContaining({ headers: { accept: "application/json" }, cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("preserves a valid zero count", async () => {
    expect((await fetchSteamCurrentPlayers({ fetchImpl: async () => Response.json({ response: { result: 1, player_count: 0 } }) })).playerCount).toBe(0);
  });

  it.each([null, {}, { response: null }, { response: { result: 0, player_count: 7 } },
    ...[-1, 1.5, "12", null, true, 2_147_483_648].map(player_count => ({ response: { result: 1, player_count } })),
  ])("rejects malformed data without turning it into a zero: %j", async payload => {
    const clock = vi.fn(() => new Date());
    await expect(fetchSteamCurrentPlayers({ fetchImpl: async () => Response.json(payload), clock })).rejects.toThrow("malformed");
    expect(clock).not.toHaveBeenCalled();
  });

  it("surfaces HTTP, non-JSON and network failures", async () => {
    await expect(fetchSteamCurrentPlayers({ fetchImpl: async () => new Response("unavailable", { status: 503 }) })).rejects.toThrow("503");
    await expect(fetchSteamCurrentPlayers({ fetchImpl: async () => new Response("not JSON") })).rejects.toThrow();
    await expect(fetchSteamCurrentPlayers({ fetchImpl: async () => { throw new Error("network timeout"); } })).rejects.toThrow("network timeout");
  });
});
