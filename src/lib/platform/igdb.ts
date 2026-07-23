import "server-only";

export const CRIMSON_DESERT_TITLE = "Crimson Desert";
export const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
export const TWITCH_GAMES_URL = "https://api.twitch.tv/helix/games";
export const TWITCH_STREAMS_URL = "https://api.twitch.tv/helix/streams";
export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TWITCH_STREAM_PAGES = 10;
const IGDB_QUERY =
  'fields id,name,slug,summary,first_release_date,platforms.name; search "Crimson Desert"; where version_parent = null; limit 10;';

export type PlatformContextFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Callers must pass the server-side Twitch application credentials explicitly.
 * The client never reads the runtime environment, and neither credential is
 * returned from any function in this module.
 */
export type PlatformContextEnv = {
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
};

export type PlatformContextStatus = "ok" | "absent" | "unconfigured" | "malformed" | "error";

export type PlatformContextResult<T> =
  | { status: "ok"; data: T; error: null }
  | { status: "absent"; data: null; error: null }
  | { status: "unconfigured" | "malformed" | "error"; data: null; error: string };

export type IgdbGameContext = {
  id: number;
  name: string;
  slug: string | null;
  summary: string | null;
  firstReleaseDate: string | null;
  platforms: string[];
};

/** A point-in-time live snapshot; it is not historical hours-watched data. */
export type TwitchLiveContext = {
  liveStreamCount: number;
  liveViewerCount: number;
  /** False only when the defensive 1,000-stream pagination cap was reached. */
  isComplete: boolean;
};

export type CrimsonDesertPlatformContext = {
  capturedAt: string;
  igdb: PlatformContextResult<IgdbGameContext>;
  twitch: PlatformContextResult<TwitchLiveContext>;
};

type IgdbGamePayload = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  summary?: unknown;
  first_release_date?: unknown;
  platforms?: unknown;
};

type TwitchGamePayload = {
  id?: unknown;
  name?: unknown;
};

type TwitchStreamPayload = {
  type?: unknown;
  viewer_count?: unknown;
};

type FetchOptions = {
  fetchImpl: PlatformContextFetch;
};

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function asNonemptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function asNonnegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function unixSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function ok<T>(data: T): PlatformContextResult<T> {
  return { status: "ok", data, error: null };
}

function absent<T>(): PlatformContextResult<T> {
  return { status: "absent", data: null, error: null };
}

function failure<T>(status: "unconfigured" | "malformed" | "error", error: string): PlatformContextResult<T> {
  return { status, data: null, error };
}

function providerError(provider: string, status: number): string {
  return `${provider} request failed (${status})`;
}

function parseIgdbGame(value: unknown): IgdbGameContext | null {
  if (!value || typeof value !== "object") return null;
  const row = value as IgdbGamePayload;
  const id = asPositiveInteger(row.id);
  const name = asNonemptyString(row.name);
  if (id === null || name === null) return null;

  const platforms: string[] = [];
  if (row.platforms !== undefined) {
    if (!Array.isArray(row.platforms)) return null;
    for (const platform of row.platforms) {
      if (!platform || typeof platform !== "object") return null;
      const platformName = asNonemptyString((platform as { name?: unknown }).name);
      if (platformName === null) return null;
      platforms.push(platformName);
    }
  }

  return {
    id,
    name,
    slug: asNonemptyString(row.slug),
    summary: asNonemptyString(row.summary),
    firstReleaseDate: unixSecondsToIso(row.first_release_date),
    platforms: [...new Set(platforms)],
  };
}

function parseTwitchGame(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as TwitchGamePayload;
  const id = asNonemptyString(row.id);
  const name = asNonemptyString(row.name);
  return id && name ? { id, name } : null;
}

function parseTwitchStreamPage(
  value: unknown,
): { liveStreamCount: number; liveViewerCount: number; cursor: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { data?: unknown }).data;
  if (!Array.isArray(rows)) return null;

  let liveStreamCount = 0;
  let liveViewerCount = 0;
  for (const stream of rows) {
    if (!stream || typeof stream !== "object") return null;
    const row = stream as TwitchStreamPayload;
    // Helix /streams currently returns live streams. Keep the type check so a
    // changed/malformed fixture cannot silently become a false live count.
    if (row.type !== "live") return null;
    const viewerCount = asNonnegativeInteger(row.viewer_count);
    if (viewerCount === null) return null;
    liveStreamCount += 1;
    liveViewerCount += viewerCount;
  }

  const pagination = (value as { pagination?: unknown }).pagination;
  if (pagination !== undefined && (!pagination || typeof pagination !== "object")) return null;
  const cursor = pagination
    ? asNonemptyString((pagination as { cursor?: unknown }).cursor)
    : null;
  return { liveStreamCount, liveViewerCount, cursor };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function fetchTwitchToken(
  clientId: string,
  clientSecret: string,
  { fetchImpl }: FetchOptions,
): Promise<PlatformContextResult<string>> {
  let response: Response;
  try {
    response = await fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      signal: timeoutSignal(),
    });
  } catch {
    return failure("error", "Twitch token request failed (network error)");
  }
  if (!response.ok) return failure("error", providerError("Twitch token", response.status));

  const payload = await readJson(response);
  const token = payload && typeof payload === "object" ? asNonemptyString((payload as { access_token?: unknown }).access_token) : null;
  return token ? ok(token) : failure("malformed", "Twitch token response was malformed");
}

async function fetchIgdbGame(
  clientId: string,
  token: string,
  { fetchImpl }: FetchOptions,
): Promise<PlatformContextResult<IgdbGameContext>> {
  let response: Response;
  try {
    response = await fetchImpl(IGDB_GAMES_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "text/plain",
        "Client-ID": clientId,
        authorization: `Bearer ${token}`,
      },
      body: IGDB_QUERY,
      signal: timeoutSignal(),
    });
  } catch {
    return failure("error", "IGDB request failed (network error)");
  }
  if (!response.ok) return failure("error", providerError("IGDB", response.status));

  const payload = await readJson(response);
  if (!Array.isArray(payload)) return failure("malformed", "IGDB response was malformed");
  if (payload.length === 0) return absent();

  const games = payload.map(parseIgdbGame);
  if (games.some((game) => game === null)) return failure("malformed", "IGDB response was malformed");

  const game = games.find(
    (candidate): candidate is IgdbGameContext =>
      candidate !== null &&
      candidate.name.localeCompare(CRIMSON_DESERT_TITLE, undefined, { sensitivity: "accent" }) === 0,
  );
  return game ? ok(game) : absent();
}

async function fetchTwitchLive(
  clientId: string,
  token: string,
  { fetchImpl }: FetchOptions,
): Promise<PlatformContextResult<TwitchLiveContext>> {
  let gameResponse: Response;
  try {
    const gamesUrl = new URL(TWITCH_GAMES_URL);
    gamesUrl.searchParams.set("name", CRIMSON_DESERT_TITLE);
    gameResponse = await fetchImpl(gamesUrl, {
      headers: {
        accept: "application/json",
        "Client-Id": clientId,
        authorization: `Bearer ${token}`,
      },
      signal: timeoutSignal(),
    });
  } catch {
    return failure("error", "Twitch games request failed (network error)");
  }
  if (!gameResponse.ok) return failure("error", providerError("Twitch games", gameResponse.status));

  const gamePayload = await readJson(gameResponse);
  if (!gamePayload || typeof gamePayload !== "object" || !Array.isArray((gamePayload as { data?: unknown }).data)) {
    return failure("malformed", "Twitch games response was malformed");
  }
  const gameRows = ((gamePayload as { data: unknown[] }).data).map(parseTwitchGame);
  if (gameRows.some((game) => game === null)) return failure("malformed", "Twitch games response was malformed");
  const game = gameRows.find(
    (candidate): candidate is { id: string; name: string } =>
      candidate !== null &&
      candidate.name.localeCompare(CRIMSON_DESERT_TITLE, undefined, { sensitivity: "accent" }) === 0,
  );
  if (!game) return absent();

  let liveStreamCount = 0;
  let liveViewerCount = 0;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TWITCH_STREAM_PAGES; page += 1) {
    const streamsUrl = new URL(TWITCH_STREAMS_URL);
    streamsUrl.searchParams.set("game_id", game.id);
    // Helix permits at most 100 rows per page; use that bound so the aggregate
    // is not needlessly limited to the endpoint's smaller default page.
    streamsUrl.searchParams.set("first", "100");
    if (cursor) streamsUrl.searchParams.set("after", cursor);

    let streamsResponse: Response;
    try {
      streamsResponse = await fetchImpl(streamsUrl, {
        headers: {
          accept: "application/json",
          "Client-Id": clientId,
          authorization: `Bearer ${token}`,
        },
        signal: timeoutSignal(),
      });
    } catch {
      return failure("error", "Twitch streams request failed (network error)");
    }
    if (!streamsResponse.ok) return failure("error", providerError("Twitch streams", streamsResponse.status));

    const streamPage = parseTwitchStreamPage(await readJson(streamsResponse));
    if (!streamPage) return failure("malformed", "Twitch streams response was malformed");
    liveStreamCount += streamPage.liveStreamCount;
    liveViewerCount += streamPage.liveViewerCount;
    cursor = streamPage.cursor;
    if (!cursor) return ok({ liveStreamCount, liveViewerCount, isComplete: true });
  }

  return ok({ liveStreamCount, liveViewerCount, isComplete: false });
}

function credential(value: unknown): string | null {
  return asNonemptyString(value);
}

/**
 * Fetches non-evidentiary Crimson Desert metadata and a current Twitch live
 * snapshot. The returned object intentionally contains aggregates only:
 * viewer identities, channel titles, usernames, stream URLs, and OAuth tokens
 * are never copied into the context shape.
 */
export async function fetchCrimsonDesertPlatformContext({
  env = {},
  fetchImpl = fetch,
  now = new Date(),
}: {
  env?: PlatformContextEnv;
  fetchImpl?: PlatformContextFetch;
  now?: Date;
} = {}): Promise<CrimsonDesertPlatformContext> {
  const capturedAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const clientId = credential(env.TWITCH_CLIENT_ID);
  const clientSecret = credential(env.TWITCH_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return {
      capturedAt,
      igdb: failure("unconfigured", "Twitch application credentials are not configured"),
      twitch: failure("unconfigured", "Twitch application credentials are not configured"),
    };
  }

  const tokenResult = await fetchTwitchToken(clientId, clientSecret, { fetchImpl });
  if (tokenResult.status !== "ok") {
    const error = tokenResult.error ?? "Twitch token was unavailable";
    return {
      capturedAt,
      igdb: failure(tokenResult.status === "malformed" ? "malformed" : "error", error),
      twitch: failure(tokenResult.status === "malformed" ? "malformed" : "error", error),
    };
  }

  const [igdb, twitch] = await Promise.all([
    fetchIgdbGame(clientId, tokenResult.data, { fetchImpl }),
    fetchTwitchLive(clientId, tokenResult.data, { fetchImpl }),
  ]);
  return { capturedAt, igdb, twitch };
}

export const getCrimsonDesertPlatformContext = fetchCrimsonDesertPlatformContext;
