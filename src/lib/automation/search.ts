import { CURRENT_PATCH } from "@/lib/constants";

type EnvLike = Record<string, string | undefined>;

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string | null;
  observedAt: string;
  sourcePublishedAt?: string | null;
};

type SearchFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type SearchFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<SearchFetchResponse>;

export type TavilySearchOptions = {
  env?: EnvLike;
  fetcher?: SearchFetch;
  now?: Date;
  startDate?: string | null;
  /**
   * Tavily returns real `published_date` values only from its news index.
   * The complaint hunt stays on general search (the news index would drop
   * Reddit/Steam community threads); ONLY the wire's press query sets this.
   */
  topic?: "news";
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
};

export type BuildSearchQueryOptions = {
  rotationOffset?: number;
};

// Reddit (esp. r/CrimsonDesert) surfaced via Tavily is where the genuinely useful
// current-patch signals live, so the pack LEADS with subreddit-targeted queries. But
// it must stay domain-diverse: promotion needs >= 2 independent domains, so a Reddit-only
// pack could never corroborate. Keep the Steam query plus general (non-`site:`) web
// queries so clusters can still reach 2-independent-domain corroboration.
function queryPack(patchVersion: string): string[] {
  return [
    `site:reddit.com r/CrimsonDesert Crimson Desert patch ${patchVersion} crash stutter performance bug`,
    `site:reddit.com Crimson Desert patch ${patchVersion} crash freeze stutter issue`,
    `Crimson Desert patch ${patchVersion} FPS drops stutter issue`,
    `site:steamcommunity.com Crimson Desert patch ${patchVersion} stutter low FPS issue`,
    `Crimson Desert patch ${patchVersion} crash freeze issue`,
    `Crimson Desert PS5 PC performance drops patch ${patchVersion}`,
  ];
}

/**
 * The wire's press query: every few discovery turns, ONE general-search slot
 * is spent on Tavily's news index instead (same credit count as before). The
 * news index covers exactly the trusted-press domains the observation lane
 * accepts, and it is the only Tavily surface that returns real
 * `published_date` values — so wire items gain honest publication dates
 * without touching the complaint hunt or inventing any date.
 */
export const WIRE_NEWS_TURN_INTERVAL = 3;

export function buildWireNewsQuery(patchVersion: string): string {
  return `Crimson Desert patch ${patchVersion} update Pearl Abyss`;
}

export function buildSearchQueries(
  maxQueries: number,
  patchVersion = CURRENT_PATCH,
  options: BuildSearchQueryOptions = {},
): string[] {
  const QUERY_PACK = queryPack(patchVersion);
  const count = Math.max(0, Math.min(QUERY_PACK.length, Math.trunc(maxQueries)));
  const rawOffset = options.rotationOffset ?? 0;
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const normalizedOffset = ((offset % QUERY_PACK.length) + QUERY_PACK.length) % QUERY_PACK.length;
  const rotatedQueries =
    normalizedOffset === 0
      ? QUERY_PACK
      : [...QUERY_PACK.slice(normalizedOffset), ...QUERY_PACK.slice(0, normalizedOffset)];

  return rotatedQueries.slice(0, count);
}

/**
 * Source-date reality (audited 2026-07-19): Tavily only returns
 * `published_date` for `topic: "news"` requests, and the scanner deliberately
 * uses general search — the news index would drop the Reddit/Steam community
 * threads that produce every useful signal. So `sourcePublishedAt` is
 * expected to be absent for most results; the mapper preserves it whenever
 * Tavily does supply one. The single deliberate exception is the wire's press
 * slot (buildWireNewsQuery), which runs on the news index precisely so
 * trusted-press observations carry real dates. Downstream must treat
 * observed/first-seen times as scanner timestamps, never as publication
 * dates, and eligibility falls back to explicit patch-version text (see
 * automation/eligibility.ts).
 */
function mapTavilyResult(item: TavilyResult, observedAt: string): SearchResult | null {
  if (!item.title || !item.url) return null;
  let sourceDomain: string;
  try {
    sourceDomain = new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return {
    title: item.title,
    url: item.url,
    snippet: item.content ?? "",
    sourceDomain,
    observedAt,
    ...(item.published_date ? { sourcePublishedAt: item.published_date } : {}),
  };
}

export type TavilyExtractOptions = {
  env?: EnvLike;
  fetcher?: SearchFetch;
  now?: Date;
};

type TavilyExtractResult = {
  url?: string;
  raw_content?: string;
};

const REDDIT_EXTRACT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"]);
const EXTRACT_QUERY = "Crimson Desert current patch issue crash stutter performance fixed still happening player report";

function extractionUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!REDDIT_EXTRACT_HOSTS.has(parsed.hostname.toLowerCase())) return value;
    parsed.protocol = "https:";
    parsed.hostname = "old.reddit.com";
    parsed.port = "";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

/**
 * Fetch the full page text for one URL via Tavily's extract endpoint. Returns the
 * first result's trimmed raw_content, or null when no key is configured or no
 * usable content comes back. Mirrors `tavilySearch`'s injectable fetcher so tests
 * never touch the real network.
 */
export async function tavilyExtract(url: string, options: TavilyExtractOptions = {}): Promise<string | null> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return null;

  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const res = await fetcher("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      urls: [extractionUrl(url)],
      query: EXTRACT_QUERY,
      chunks_per_source: 5,
      extract_depth: "basic",
      include_usage: true,
    }),
  });
  if (!res.ok) throw new Error(`tavily extract failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyExtractResult[] };
  const rawContent = (data.results ?? [])[0]?.raw_content?.trim();
  return rawContent ? rawContent.slice(0, 4_000) : null;
}

export async function tavilySearch(query: string, options: TavilySearchOptions = {}): Promise<SearchResult[]> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return [];

  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const res = await fetcher("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: "basic",
      include_usage: true,
      ...(options.startDate ? { start_date: options.startDate } : {}),
      ...(options.topic ? { topic: options.topic } : {}),
    }),
  });
  if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyResult[] };
  const observedAt = (options.now ?? new Date()).toISOString();
  return (data.results ?? [])
    .map((item) => mapTavilyResult(item, observedAt))
    .filter((item): item is SearchResult => item !== null);
}
