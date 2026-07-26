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

/**
 * Every query here earned its place in a measured bake-off against the live API
 * (`npm run scan:bakeoff`), judged by the real pre-screen. Two rules came out of
 * that run and both are load-bearing:
 *
 * 1. A `site:` filter is not a guarantee. When the scope has no matching content
 *    Tavily does not return nothing — it drops the filter and searches openly.
 *    `site:pcgamer.com Crimson Desert patch performance` came back as Borderlands
 *    4, Helldivers 2 and Oblivion mods, and junk on a TRUSTED domain is worse
 *    than junk anywhere else, because a trusted domain is what qualifies a
 *    candidate for a paid recon fetch.
 *
 *    What decides it is whether the SCOPE is dedicated to this game. Measured
 *    5 of 5 in scope alone: `crimsondesert.pearlabyss.com`, the Steam app's
 *    news, `r/CrimsonDesert`. Those places are about Crimson Desert or they are
 *    empty. A general outlet publishes about everything, so in a week with no
 *    Crimson Desert coverage the fallback is whatever it did publish — which is
 *    why no PRESS outlet is ever asked alone.
 *
 *    Note `pearlabyss.com` is NOT such a scope: the publisher also ships Black
 *    Desert, and `hasCrimsonDesertContext` accepts the publisher's name, so a
 *    root-scoped result could carry another game's pages into the pipeline. The
 *    official query is pinned to the game's own subdomain for that reason.
 *
 * 2. Grouping is not a guarantee either. `site:A OR site:B` holds only while at
 *    least one member carries matching content. Measured: pairing the Pearl Abyss
 *    ROOT domain (which indexes almost nothing) with the Steam store collapsed so
 *    completely that Tavily matched the bare word "OR" and returned five
 *    dictionary definitions of it. The same pair pointed at the game's own
 *    subdomain returned 5 of 5 in scope. Every group therefore needs one member
 *    that reliably carries coverage.
 *
 * 3. Anchor the open-web query in the game, not the words. Unanchored
 *    "Crimson Desert patch" matched a coffee brand, a dictionary, the Harvard
 *    Crimson store and the US Army Corps of Engineers.
 *
 * Domain diversity is the point, not a nicety: promotion needs >= 2 independent
 * registrable domains, and Reddit alone can never corroborate itself no matter
 * how many threads it contributes. The press trios rotate by turn, so a trio
 * that is empty this turn is not a permanent loss.
 */
function queryPack(patchVersion: string): string[] {
  return [
    // The game's own site, not the publisher's. Measured 5 of 5 in scope alone.
    `site:crimsondesert.pearlabyss.com Crimson Desert patch ${patchVersion} notes known issues`,
    // Measured 5 of 5 in scope across three separate runs, and every result routed
    // to an observation lane. The version matters: without it the same filter
    // collapsed and returned wikipedia and vocabulary.com.
    `site:store.steampowered.com Crimson Desert patch ${patchVersion} update`,
    // Anchored open web: measured 2 kept + 2 observations, and no coffee.
    `Crimson Desert game Pearl Abyss patch ${patchVersion} players stutter crash bug report`,
    // One Reddit query, down from four. Still where players complain.
    `site:reddit.com r/CrimsonDesert Crimson Desert patch ${patchVersion} crash stutter performance bug`,
    `site:steamcommunity.com Crimson Desert patch ${patchVersion} stutter low FPS issue`,
    // Console/PC performance press: measured 2 kept signals, the non-Reddit
    // corroboration single-source clusters have been waiting for.
    `site:pushsquare.com OR site:purexbox.com OR site:wccftech.com Crimson Desert patch performance problems`,
    `site:pcgamer.com OR site:eurogamer.net OR site:dsogaming.com Crimson Desert patch performance problems`,
    `site:ign.com OR site:gamespot.com OR site:polygon.com Crimson Desert patch update problems`,
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

/**
 * Deliberately carries NO patch version, and deliberately does NOT quote the
 * game name. Both were measured against the live news index:
 *
 *   - versioned            -> 0 of 5 on topic (Path of Exile, 007 First Light)
 *   - "Crimson Desert"     -> 0 of 5 on topic
 *   - this query           -> 3 of 5 on topic, both dated 1.15.00 articles
 *
 * Quoting helps on general search and hurts here, which is why the two surfaces
 * get different query shapes rather than one house style. A version string that
 * appears in no headline leaves the index matching the generic words around it;
 * the patch gates downstream still decide what is stored, so naming the version
 * bought nothing and cost the whole result set.
 *
 * The news index is volatile: consecutive runs of this exact query returned 3 of
 * 5 and 0 of 5 on topic minutes apart. Off-topic results are correctly dropped as
 * `off_topic`, so a bad draw costs one credit and never reaches the Brief. Judge
 * this slot over several runs of `npm run scan:bakeoff`, never a single one.
 */
export function buildWireNewsQuery(): string {
  return "Crimson Desert Pearl Abyss patch update performance";
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
 * Fetch the full page text for one URL via Tavily's extract endpoint. Mirrors
 * `tavilySearch`'s injectable fetcher so tests never touch the real network.
 *
 * The return value is a billing claim the caller charges against the monthly
 * ledger, so each outcome has to mean exactly one thing:
 *
 *   - a string: Tavily delivered page text and billed for it;
 *   - null: CONFIRMED UNBILLED. Either no key was configured, so no request was
 *     made, or Tavily answered 200 and named the URL in `failed_results`, which
 *     it does not charge for. Reddit refuses Tavily's fetcher, so its threads
 *     always land here;
 *   - throws: everything else. A non-ok status, or a 200 whose payload is empty,
 *     malformed, or carries blank text without stating a refusal. Tavily may
 *     already have billed the work behind such a response, and nothing here can
 *     tell. The caller charges worst case rather than assuming it was free —
 *     understating spend would let a later run overrun the monthly cap.
 */
export async function tavilyExtract(url: string, options: TavilyExtractOptions = {}): Promise<string | null> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return null;

  const requestedUrl = extractionUrl(url);
  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const res = await fetcher("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      urls: [requestedUrl],
      query: EXTRACT_QUERY,
      chunks_per_source: 5,
      extract_depth: "basic",
      include_usage: true,
    }),
  });
  if (!res.ok) throw new Error(`tavily extract failed: ${res.status}`);

  const data = (await res.json()) as {
    results?: TavilyExtractResult[];
    failed_results?: { url?: string; error?: string }[];
    usage?: { credits?: number };
  };
  const rawContent = (data.results ?? [])[0]?.raw_content?.trim();
  if (rawContent) return rawContent.slice(0, 4_000);

  // A refusal only waives the charge when Tavily actually names the URL we asked
  // for. A malformed entry — `[{}]`, a bare string, or a different URL — says
  // nothing about whether the work was billed, so it takes the throwing path and
  // is charged worst case. Anything less strict here would let corrupted provider
  // data quietly understate the month.
  const refusedRequestedUrl = (data.failed_results ?? []).some(
    (entry) => typeof entry?.url === "string" && entry.url === requestedUrl,
  );

  // `include_usage` is requested, so honour it — but only as a VETO. Observed live:
  // a refused fetch and a successful extract BOTH report `usage: {credits: 0}`, so
  // a zero here cannot prove nothing was billed. It can only contradict a waiver.
  //
  // Exactly 0 is the ONLY value consistent with a free refusal. Everything else
  // contradicts it: a positive count is a charged failure, and a negative, absent,
  // or non-numeric count is corrupted data that says nothing either way. All of them
  // take the throwing path where the caller books the credit worst case. A response
  // carrying no `usage` field at all makes no claim, so it falls back to the URL
  // match rather than being treated as a contradiction.
  const usageContradictsWaiver = data.usage !== undefined && data.usage.credits !== 0;

  if (refusedRequestedUrl && !usageContradictsWaiver) return null;
  throw new Error("tavily extract returned no content");
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
