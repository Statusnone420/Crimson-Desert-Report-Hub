import { describe, expect, it, vi } from "vitest";
import {
  fetchCrimsonDesertPlatformContext,
  IGDB_GAMES_URL,
  TWITCH_GAMES_URL,
  TWITCH_STREAMS_URL,
  TWITCH_TOKEN_URL,
} from "@/lib/platform/igdb";

const env = {
  TWITCH_CLIENT_ID: "fixture-client-id",
  TWITCH_CLIENT_SECRET: "fixture-client-secret",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(String(input));
}

describe("Crimson Desert IGDB/Twitch platform context", () => {
  it("uses server-side app credentials and returns metadata plus live aggregates only", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = requestUrl(input);
      if (url.href === TWITCH_TOKEN_URL) return response({ access_token: "fixture-oauth-token", expires_in: 3600 });
      if (url.href === IGDB_GAMES_URL) {
        return response([{
          id: 12345,
          name: "Crimson Desert",
          slug: "crimson-desert",
          summary: "A fixture summary.",
          first_release_date: 1_774_000_000,
          platforms: [{ id: 6, name: "PC (Microsoft Windows)" }, { id: 48, name: "PlayStation 4" }],
        }]);
      }
      if (url.origin + url.pathname === TWITCH_GAMES_URL) {
        return response({ data: [{ id: "98765", name: "Crimson Desert", box_art_url: "https://private.example/box" }] });
      }
      if (url.origin + url.pathname === TWITCH_STREAMS_URL) {
        return response({
          data: [
            {
              id: "stream-1",
              user_id: "viewer-1",
              user_login: "private-login",
              user_name: "Private Name",
              game_id: "98765",
              game_name: "Crimson Desert",
              type: "live",
              title: "Private stream title",
              thumbnail_url: "https://private.example/thumbnail",
              viewer_count: 12,
            },
            {
              id: "stream-2",
              user_id: "viewer-2",
              user_login: "private-login-2",
              user_name: "Private Name 2",
              game_id: "98765",
              game_name: "Crimson Desert",
              type: "live",
              title: "Another private stream title",
              viewer_count: 8,
            },
          ],
        });
      }
      throw new Error(`unexpected fixture URL: ${url.href}`);
    });

    const context = await fetchCrimsonDesertPlatformContext({
      env,
      fetchImpl,
      now: new Date("2026-07-22T15:00:00.000Z"),
    });

    expect(context).toEqual({
      capturedAt: "2026-07-22T15:00:00.000Z",
      igdb: {
        status: "ok",
        error: null,
        data: {
          id: 12345,
          name: "Crimson Desert",
          slug: "crimson-desert",
          summary: "A fixture summary.",
          firstReleaseDate: "2026-03-20T09:46:40.000Z",
          platforms: ["PC (Microsoft Windows)", "PlayStation 4"],
        },
      },
      twitch: {
        status: "ok",
        error: null,
        data: { liveStreamCount: 2, liveViewerCount: 20, isComplete: true },
      },
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("fixture-oauth-token");
    expect(serialized).not.toContain("private-login");
    expect(serialized).not.toContain("Private Name");
    expect(serialized).not.toContain("Private stream title");
    expect(serialized).not.toContain("private.example");

    const tokenCall = fetchImpl.mock.calls.find(([input]) => requestUrl(input).href === TWITCH_TOKEN_URL);
    expect(tokenCall).toBeDefined();
    expect((tokenCall?.[1] as RequestInit).method).toBe("POST");
    expect(String((tokenCall?.[1] as RequestInit).body)).toContain("grant_type=client_credentials");

    const igdbCall = fetchImpl.mock.calls.find(([input]) => requestUrl(input).href === IGDB_GAMES_URL);
    expect((igdbCall?.[1] as RequestInit).method).toBe("POST");
    expect(String((igdbCall?.[1] as RequestInit).body)).toContain('search "Crimson Desert"');

    const streamsCall = fetchImpl.mock.calls.find(([input]) => requestUrl(input).pathname === "/helix/streams");
    expect(streamsCall).toBeDefined();
    const streamsUrl = requestUrl(streamsCall?.[0] as string);
    expect(streamsUrl.searchParams.get("game_id")).toBe("98765");
    expect(streamsUrl.searchParams.get("first")).toBe("100");
  });

  it("reports a successful zero-live snapshot without implying historical watch time", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.href === TWITCH_TOKEN_URL) return response({ access_token: "fixture-token" });
      if (url.href === IGDB_GAMES_URL) return response([{ id: 1, name: "Crimson Desert", platforms: [] }]);
      if (url.origin + url.pathname === TWITCH_GAMES_URL) return response({ data: [{ id: "2", name: "Crimson Desert" }] });
      if (url.origin + url.pathname === TWITCH_STREAMS_URL) return response({ data: [] });
      throw new Error(`unexpected fixture URL: ${url.href}`);
    });

    const context = await fetchCrimsonDesertPlatformContext({ env, fetchImpl });

    expect(context.twitch).toEqual({
      status: "ok",
      error: null,
      data: { liveStreamCount: 0, liveViewerCount: 0, isComplete: true },
    });
    expect(JSON.stringify(context)).not.toContain("hours");
  });

  it("distinguishes valid provider absence from malformed payloads", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.href === TWITCH_TOKEN_URL) return response({ access_token: "fixture-token" });
      if (url.href === IGDB_GAMES_URL) return response([]);
      if (url.origin + url.pathname === TWITCH_GAMES_URL) return response({ data: [] });
      throw new Error(`unexpected fixture URL: ${url.href}`);
    });

    const absent = await fetchCrimsonDesertPlatformContext({ env, fetchImpl });
    expect(absent.igdb).toEqual({ status: "absent", data: null, error: null });
    expect(absent.twitch).toEqual({ status: "absent", data: null, error: null });
    expect(fetchImpl.mock.calls.some(([input]) => requestUrl(input).pathname === "/helix/streams")).toBe(false);

    const malformedFetch = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.href === TWITCH_TOKEN_URL) return response({ access_token: "fixture-token" });
      if (url.href === IGDB_GAMES_URL) return response({ data: "not-an-array" });
      if (url.origin + url.pathname === TWITCH_GAMES_URL) return response({ data: [{ id: "2", name: "Crimson Desert" }] });
      if (url.origin + url.pathname === TWITCH_STREAMS_URL) return response({ data: [{ type: "live", viewer_count: "unknown" }] });
      throw new Error(`unexpected fixture URL: ${url.href}`);
    });

    const malformed = await fetchCrimsonDesertPlatformContext({ env, fetchImpl: malformedFetch });
    expect(malformed.igdb).toMatchObject({ status: "malformed", data: null });
    expect(malformed.twitch).toMatchObject({ status: "malformed", data: null });

    for (const viewerCount of [null, false]) {
      const coerciveFetch = vi.fn(async (input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url.href === TWITCH_TOKEN_URL) return response({ access_token: "fixture-token" });
        if (url.href === IGDB_GAMES_URL) return response([{ id: 1, name: "Crimson Desert", platforms: [] }]);
        if (url.origin + url.pathname === TWITCH_GAMES_URL) return response({ data: [{ id: "2", name: "Crimson Desert" }] });
        if (url.origin + url.pathname === TWITCH_STREAMS_URL) return response({ data: [{ type: "live", viewer_count: viewerCount }] });
        throw new Error(`unexpected fixture URL: ${url.href}`);
      });
      const coercive = await fetchCrimsonDesertPlatformContext({ env, fetchImpl: coerciveFetch });
      expect(coercive.twitch).toMatchObject({ status: "malformed", data: null });
    }
  });

  it("fails closed when credentials are missing or the token provider fails", async () => {
    const noCall = vi.fn(async () => response({ access_token: "unexpected" }));
    const unconfigured = await fetchCrimsonDesertPlatformContext({ env: {}, fetchImpl: noCall });
    expect(unconfigured.igdb).toMatchObject({ status: "unconfigured", data: null });
    expect(unconfigured.twitch).toMatchObject({ status: "unconfigured", data: null });
    expect(noCall).not.toHaveBeenCalled();

    const tokenFailure = vi.fn(async () => response({ message: "nope" }, 503));
    const failed = await fetchCrimsonDesertPlatformContext({ env, fetchImpl: tokenFailure });
    expect(failed.igdb).toEqual({ status: "error", data: null, error: "Twitch token request failed (503)" });
    expect(failed.twitch).toEqual({ status: "error", data: null, error: "Twitch token request failed (503)" });
    expect(JSON.stringify(failed)).not.toContain("fixture-client-secret");
    expect(tokenFailure).toHaveBeenCalledTimes(1);
  });
});
