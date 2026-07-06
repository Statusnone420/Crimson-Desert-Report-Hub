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

function queryPack(patchVersion: string): string[] {
  return [
    `Crimson Desert patch ${patchVersion} FPS drops stutter issue`,
    `Crimson Desert patch ${patchVersion} crash freeze issue`,
    `site:reddit.com Crimson Desert patch ${patchVersion} crash freeze stutter issue`,
    `site:steamcommunity.com Crimson Desert patch ${patchVersion} stutter low FPS issue`,
    `Crimson Desert PS5 PC performance drops patch ${patchVersion}`,
    `Crimson Desert latest patch ${patchVersion} known issue hotfix`,
  ];
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
    body: JSON.stringify({ urls: [url] }),
  });
  if (!res.ok) throw new Error(`tavily extract failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyExtractResult[] };
  const rawContent = (data.results ?? [])[0]?.raw_content?.trim();
  return rawContent ? rawContent : null;
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
    }),
  });
  if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyResult[] };
  const observedAt = (options.now ?? new Date()).toISOString();
  return (data.results ?? [])
    .map((item) => mapTavilyResult(item, observedAt))
    .filter((item): item is SearchResult => item !== null);
}
