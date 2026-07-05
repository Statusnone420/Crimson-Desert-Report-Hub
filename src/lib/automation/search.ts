import { CURRENT_PATCH } from "@/lib/constants";

type EnvLike = Record<string, string | undefined>;

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string | null;
  observedAt: string;
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
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};

function queryPack(patchVersion: string): string[] {
  return [
    `Crimson Desert patch ${patchVersion} FPS drops stutter issue`,
    `Crimson Desert patch ${patchVersion} crash freeze issue`,
    `Crimson Desert map crash persists after patch ${patchVersion}`,
    `Crimson Desert PS5 Pro performance drops patch ${patchVersion}`,
    `Crimson Desert Steam stutter low FPS patch ${patchVersion}`,
  ];
}

export function buildSearchQueries(maxQueries: number, patchVersion = CURRENT_PATCH): string[] {
  const QUERY_PACK = queryPack(patchVersion);
  return QUERY_PACK.slice(0, Math.max(0, Math.min(QUERY_PACK.length, Math.trunc(maxQueries))));
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
  };
}

export async function tavilySearch(query: string, options: TavilySearchOptions = {}): Promise<SearchResult[]> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return [];

  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const res = await fetcher("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
  });
  if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyResult[] };
  const observedAt = (options.now ?? new Date()).toISOString();
  return (data.results ?? [])
    .map((item) => mapTavilyResult(item, observedAt))
    .filter((item): item is SearchResult => item !== null);
}
