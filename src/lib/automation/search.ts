
import { paidProviderRequest, type PaidOperationGuard } from "./paidOperation";
type EnvLike = Record<string, string | undefined>;

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string | null;
  observedAt: string;
  sourcePublishedAt?: string | null;
  /** Tavily's 1-based position, set only when `withProviderRank` is requested. */
  providerRank?: number;
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
    signal?: AbortSignal;
  },
) => Promise<SearchFetchResponse>;

export type TavilySearchOptions = {
  paidGuard?: PaidOperationGuard;
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
  /** Results requested; production keeps 5. Measurement tools may ask for up to 20. */
  maxResults?: number;
  /** Receives Tavily's reported credit charge, or null when the response omits it. */
  onCredits?: (credits: number | null) => void;
  /** Measurement only: keep Tavily's position on each result before invalid rows are dropped. */
  withProviderRank?: boolean;
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
 *    Collapse is also INTERMITTENT, which is the part worth remembering. The
 *    versionless pcgamer/eurogamer/dsogaming trio returned three real Crimson
 *    Desert articles in one run and five dictionary definitions of "OR" four
 *    minutes later. Adding the patch version to the same trio returned three
 *    on-domain results, two of them naming 1.15.00. A version is therefore not
 *    only what lets a press article clear canPublish, it is also what keeps the
 *    group anchored. No press slot ships without one.
 *
 * 3. A `site:` scope that is genuinely dedicated to the game can still be the
 *    wrong QUESTION. `site:store.steampowered.com Crimson Desert patch <v>
 *    update` was measured 5 of 5 in scope and looked like the best slot in the
 *    pack — but in scope means store pages: a Thai Deluxe Pack listing, a German
 *    storefront, an English Deluxe Pack listing. None are patch notes, and
 *    `steampowered.com` is not in TRUSTED_DOMAINS, so the observation gate
 *    discards them regardless of what the pre-screen decides. The slot was
 *    dropped rather than trusted: trusting the domain would also reclassify
 *    every Steam review the run stamps with it.
 *
 * 4. Anchor the open-web query in the game, not the words. Unanchored
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
    // Anchored open web: the highest-yield slot in the pack. Measured 2 kept + 2
    // observations across five distinct domains, and no coffee.
    `Crimson Desert game Pearl Abyss patch ${patchVersion} players stutter crash bug report`,
    // One Reddit query, down from four. Still where players complain.
    `site:reddit.com r/CrimsonDesert Crimson Desert patch ${patchVersion} crash stutter performance bug`,
    `site:steamcommunity.com Crimson Desert patch ${patchVersion} stutter low FPS issue`,
    // Console/PC performance press: the non-Reddit corroboration single-source
    // clusters have been waiting for. Every trio carries the version — see the
    // note on group collapse above, and note that a press article that never
    // names the current patch cannot clear canPublish, so a versionless press
    // hit is stored context at best and can never be the second domain.
    `site:pushsquare.com OR site:purexbox.com OR site:wccftech.com Crimson Desert patch ${patchVersion} performance problems`,
    `site:pcgamer.com OR site:eurogamer.net OR site:dsogaming.com Crimson Desert patch ${patchVersion} performance problems`,
    `site:ign.com OR site:gamespot.com OR site:polygon.com Crimson Desert patch ${patchVersion} update problems`,
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
  patchVersion: string,
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
  if (!item || typeof item !== "object" || typeof item.title !== "string" || !item.title
    || typeof item.url !== "string" || !item.url) return null;
  let sourceDomain: string;
  try {
    sourceDomain = new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return {
    title: item.title,
    url: item.url,
    snippet: typeof item.content === "string" ? item.content : "",
    sourceDomain,
    observedAt,
    ...(typeof item.published_date === "string" && item.published_date ? { sourcePublishedAt: item.published_date } : {}),
  };
}

export type TavilyExtractOptions = {
  paidGuard?: PaidOperationGuard;
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

/** True for an absolute http(s) URL, the only kind an extract reads. */
function isHttpUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value) && URL.canParse(value);
}

/** Tavily answered 200 without page text or a refusal. The read is already booked; skip the page. */
export class TavilyExtractNoContentError extends Error {
  constructor() {
    super("tavily extract returned no content");
    this.name = "TavilyExtractNoContentError";
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
 *     made, or Tavily answered 200 with a well-formed answer that names the URL
 *     in `failed_results` and returns no result, which it does not charge for.
 *     Reddit refuses Tavily's fetcher, so its threads usually land here;
 *   - throws TavilyExtractNoContentError: a well-formed 200 whose results carry
 *     no text and state no refusal. Well-formed means every entry, kept or
 *     refused, is an object with an http(s) URL. Tavily may have billed the read,
 *     so it is booked at Tavily's stated count, or at the one reserved credit,
 *     which is the most a basic extract of one URL costs. The cost is bounded,
 *     so later paid work in the run may continue; the caller skips the page;
 *   - throws anything else: a non-ok status, a timeout, or a malformed payload,
 *     such as a list that is not an array, or an entry that is `{}`, a bare
 *     string or a null, or lacks an http(s) URL.
 *     Tavily may already have billed the work behind such a response, and
 *     nothing here can tell. The cost is booked unknown and the caller charges
 *     worst case rather than assuming it was free — understating spend would
 *     let a later run overrun the monthly cap.
 */
export async function tavilyExtract(url: string, options: TavilyExtractOptions = {}): Promise<string | null> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return null;

  const requestedUrl = extractionUrl(url);
  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const body = JSON.stringify({ urls: [requestedUrl], query: EXTRACT_QUERY,
    chunks_per_source: 5, extract_depth: "basic", include_usage: true });
  const operation = await options.paidGuard?.begin("tavily_extract", body, 0, 1);
  let dispatched = false;
  let data: { results?: TavilyExtractResult[]; failed_results?: { url?: string; error?: string }[]; usage?: { credits?: number } };
  try {
    data = await paidProviderRequest(options.paidGuard, async (signal) => {
      signal.throwIfAborted();
      dispatched = true;
      const res = await fetcher("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body, signal,
      });
      if (!res.ok) throw new Error(`tavily extract failed: ${res.status}`);
      const value = await res.json() as typeof data;
      // An answer is an object; its lists, when present, are arrays, and its usage is an object.
      if (!value || typeof value !== "object" || Array.isArray(value)
        || value.results !== undefined && !Array.isArray(value.results)
        || value.failed_results !== undefined && !Array.isArray(value.failed_results)
        || value.results?.some((item) => item?.raw_content !== undefined && typeof item.raw_content !== "string")
        || value.usage !== undefined && (!value.usage || typeof value.usage !== "object" || Array.isArray(value.usage))) {
        throw new Error("tavily extract returned invalid results");
      }
      return value;
    });
  } catch (error) {
    await operation?.settle({ state: dispatched ? "unknown" : "not_sent",
      llmCostUsd: dispatched ? null : 0, tavilyCredits: dispatched ? null : 0 });
    throw error;
  }
  // A billed read: Tavily's stated count when usable, otherwise the one reserved credit.
  const credits = data.usage?.credits;
  const billed = { state: typeof credits === "number" && Number.isSafeInteger(credits) && credits > 0 ? "verified" as const : "estimated" as const,
    llmCostUsd: 0, tavilyCredits: typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? Math.max(1, Math.ceil(credits)) : 1 };
  const rawContent = (data.results ?? [])[0]?.raw_content?.trim();
  if (rawContent) {
    await operation?.settle(billed);
    return rawContent.slice(0, 4_000);
  }

  // Without page text, only a well-formed answer may waive or bound the charge: every
  // entry, kept or refused, must be an object with an http(s) `url`. `{}`, a blank or
  // non-web URL, a bare string or a null says nothing about what Tavily did, so it
  // keeps the unknown cost, even beside a refusal that names our URL.
  if (![...(data.results ?? []), ...(data.failed_results ?? [])].every((entry) => isHttpUrl(entry?.url))) {
    await operation?.settle({ state: "unknown", llmCostUsd: null, tavilyCredits: null });
    throw new Error("tavily extract returned invalid results");
  }

  // A refusal only waives the charge when Tavily actually names the URL we asked
  // for and returns no result beside it. A refusal of a different URL, or one next
  // to a result, is booked below as a billed read. Anything less strict here would
  // let corrupted provider data quietly understate the month.
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
  // are booked as a billed read below. A response carrying no `usage` field at all
  // makes no claim, so it falls back to the URL match rather than being treated as
  // a contradiction.
  const usageContradictsWaiver = data.usage !== undefined && data.usage.credits !== 0;

  if (refusedRequestedUrl && !usageContradictsWaiver && !(data.results ?? []).length) {
    await operation?.settle({ state: "verified", llmCostUsd: 0, tavilyCredits: 0 });
    return null;
  }
  // Empty but answered. Booking an unknown cost here would stop every later paid
  // call in the run over one empty page; the bounded worst case is booked instead.
  await operation?.settle(billed);
  throw new TavilyExtractNoContentError();
}

export async function tavilySearch(query: string, options: TavilySearchOptions = {}): Promise<SearchResult[]> {
  const key = (options.env ?? process.env).TAVILY_API_KEY?.trim();
  if (!key) return [];

  const fetcher = options.fetcher ?? (fetch as unknown as SearchFetch);
  const body = JSON.stringify({
    query,
    max_results: Math.min(20, Math.max(1, Math.trunc(options.maxResults ?? 5))),
    search_depth: "basic",
    include_usage: true,
    ...(options.startDate ? { start_date: options.startDate } : {}),
    ...(options.topic ? { topic: options.topic } : {}),
  });
  const operation = await options.paidGuard?.begin("tavily_search", body, 0, 1);
  let dispatched = false;
  let data: { results?: TavilyResult[]; usage?: { credits?: number } };
  try {
    data = await paidProviderRequest(options.paidGuard, async (signal) => {
      signal.throwIfAborted();
      dispatched = true;
      const res = await fetcher("https://api.tavily.com/search", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body, signal,
      });
      if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);
      const value = await res.json() as typeof data;
      if (!value || typeof value !== "object" || !Array.isArray(value.results ?? [])) throw new Error("tavily search returned invalid results");
      return value;
    });
  } catch (error) {
    await operation?.settle({ state: dispatched ? "unknown" : "not_sent",
      llmCostUsd: dispatched ? null : 0, tavilyCredits: dispatched ? null : 0 });
    throw error;
  }
  const credits = data.usage?.credits;
  options.onCredits?.(typeof credits === "number" && Number.isFinite(credits) ? credits : null);
  await operation?.settle({ state: typeof credits === "number" && Number.isSafeInteger(credits) && credits > 0 ? "verified" : "estimated",
    llmCostUsd: 0, tavilyCredits: typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? Math.max(1, Math.ceil(credits)) : 1 });
  const observedAt = (options.now ?? new Date()).toISOString();
  return (data.results ?? [])
    .map((item, index) => {
      const mapped = mapTavilyResult(item, observedAt);
      return mapped && options.withProviderRank ? { ...mapped, providerRank: index + 1 } : mapped;
    })
    .filter((item): item is SearchResult => item !== null);
}
