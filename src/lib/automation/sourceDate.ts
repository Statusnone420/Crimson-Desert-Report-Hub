import { explicitPatchVersions } from "@/lib/automation/eligibility";
import {
  ASCII_EDGE_BLANKS,
  hasUsableDate,
  isDisplayableDatedObservation,
  patchEraFloorMs,
} from "@/lib/observationDisplay";
import { belongsToPatchFamily } from "@/lib/patchWatch";

/**
 * The single place a source's publication date is decided.
 *
 * Before this module, four different code paths guessed at a date and one of
 * them — a loose month/day scan over the whole snippet — routinely stamped an
 * unrelated calendar date onto a page. A wrong date is worse than no date: it
 * decides current-patch eligibility, it sorts From the Wire, and once stored it
 * is what a reader sees. So the rule here is that a date must be ASSERTED by
 * the source, in one of four shapes we can point at, or the answer is null.
 *
 * What this module deliberately does NOT do: fetch a webpage, call another
 * provider, scrape arbitrary HTML, or infer anything. It reads what the search
 * result already carried.
 */

export type SourceDateProvenance =
  | "provider"
  | "reddit_posted_iso"
  | "anchored_patch_title"
  | "exact_canonical_url"
  | null;

export type ResolvedSourceDate = {
  value: string | null;
  provenance: SourceDateProvenance;
};

export type SourceDateInput = {
  title: string;
  /** Snippet or full page text, exactly as received. Never editorialized. */
  sourceText: string;
  /** Already normalized by canonicalizeUrl — the identity the stored map is keyed by. */
  canonicalUrl: string;
  /** A publication date the search provider itself supplied, if any. */
  sourcePublishedAt?: string | null;
  /**
   * Dates already stored for pages we have seen before, keyed by the SAME
   * normalized canonical URL. Never a domain, a title, or a cluster — a date
   * describes one page and may not travel to another.
   */
  storedDatesByCanonicalUrl?: ReadonlyMap<string, string | null>;
};

export type SourceDatePatchContext = {
  version: string;
  publishedAt: string | null;
};

const UNRESOLVED: ResolvedSourceDate = { value: null, provenance: null };

/**
 * Reddit's own byline, and only that: `Posted by u/someone on 2026-07-24T09:12:00Z`.
 * The ISO timestamp must be the thing the word "on" introduces — a date sitting
 * loose in the body is not this shape and is not accepted.
 */
const REDDIT_POSTED_ISO =
  /\bposted\s+by\b[^\n]{0,120}?\bon\s+(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)(?![\d-])/i;

/**
 * reddit.com and its subdomains, nothing that merely contains the string. The
 * leading `(?:^|\.)` is what separates `old.reddit.com` from `evilreddit.com`,
 * and the `$` anchor is what stops `reddit.com.evil.example`. Same predicate
 * shape the pre-screen uses to identify a subreddit.
 */
const REDDIT_HOST = /(?:^|\.)reddit\.com$/i;

/**
 * Byline provenance comes from the URL, never from the text. A search snippet
 * can quote or splice another page's content, so a Steam thread that happens to
 * carry "Posted by … on <ISO>" must not be dated as if Reddit had said it. A
 * URL that will not parse establishes nothing either.
 */
function isRedditUrl(canonicalUrl: string): boolean {
  try {
    return REDDIT_HOST.test(new URL(canonicalUrl).hostname);
  } catch {
    return false;
  }
}

/** "Patch Notes", "Update Notes", "Hotfix Notes" — the announcement's own shape. */
const PATCH_NOTE_TITLE = /\b(?:patch|update|hotfix)\s+notes?\b/i;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Unambiguous means: a named month, a day, and an EXPLICIT four-digit year, or a
 * full ISO day. "July 24" is rejected — the year would have to be inferred, and
 * inference is exactly what this module exists to stop. Numeric forms like
 * 07/24/2026 are rejected too: day/month order is a coin flip across locales.
 */
const NAMED_MONTH_DATE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
const ISO_DAY = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function isoDay(year: number, month: number, day: number): string | null {
  const composed = new Date(Date.UTC(year, month - 1, day));
  if (
    composed.getUTCFullYear() !== year ||
    composed.getUTCMonth() !== month - 1 ||
    composed.getUTCDate() !== day
  ) {
    return null;
  }
  return composed.toISOString().slice(0, 10);
}

/**
 * Returns the single unambiguous calendar day a string states, or null if it
 * states none — or more than one. Two dates in one title means the title does
 * not tell us which is the publication date, and picking either would be a
 * guess.
 */
function loneUnambiguousCalendarDay(text: string): string | null {
  const days = new Set<string>();
  for (const match of text.matchAll(NAMED_MONTH_DATE)) {
    const day = isoDay(Number(match[3]), MONTH_NAMES[match[1].toLowerCase()], Number(match[2]));
    if (day) days.add(day);
  }
  for (const match of text.matchAll(ISO_DAY)) {
    const day = isoDay(Number(match[1]), Number(match[2]), Number(match[3]));
    if (day) days.add(day);
  }
  return days.size === 1 ? [...days][0] : null;
}

function fromProvider(input: SourceDateInput): ResolvedSourceDate {
  const value = input.sourcePublishedAt?.replace(ASCII_EDGE_BLANKS, "");
  return value ? { value, provenance: "provider" } : UNRESOLVED;
}

function fromRedditByline(input: SourceDateInput): ResolvedSourceDate {
  if (!isRedditUrl(input.canonicalUrl)) return UNRESOLVED;
  const match = REDDIT_POSTED_ISO.exec(input.sourceText);
  return match ? { value: match[1], provenance: "reddit_posted_iso" } : UNRESOLVED;
}

function fromAnchoredPatchTitle(
  input: SourceDateInput,
  patch: SourceDatePatchContext,
): ResolvedSourceDate {
  if (!PATCH_NOTE_TITLE.test(input.title)) return UNRESOLVED;
  const namesThisPatch = explicitPatchVersions(input.title).some((version) =>
    belongsToPatchFamily(version, patch.version),
  );
  if (!namesThisPatch) return UNRESOLVED;
  const day = loneUnambiguousCalendarDay(input.title);
  return day ? { value: `${day}T00:00:00.000Z`, provenance: "anchored_patch_title" } : UNRESOLVED;
}

function fromStoredExactUrl(input: SourceDateInput): ResolvedSourceDate {
  const stored = input.storedDatesByCanonicalUrl?.get(input.canonicalUrl);
  return stored ? { value: stored, provenance: "exact_canonical_url" } : UNRESOLVED;
}

/**
 * Format allowlist, real-calendar-day check and the 48-hour future-skew bound.
 * `patchPublishedAt` is passed through to the shared display predicate, which
 * skips the era floor when it is null — that is the difference between the two
 * exported resolvers below.
 */
function passesGates(value: string, patchPublishedAt: string | null, nowMs: number): boolean {
  if (!hasUsableDate(value)) return false;
  return isDisplayableDatedObservation(
    { source_published_at: value.replace(ASCII_EDGE_BLANKS, "") },
    patchPublishedAt,
    nowMs,
  );
}

function resolveInPrecedenceOrder(
  input: SourceDateInput,
  patch: SourceDatePatchContext,
  nowMs: number,
  patchPublishedAtForGates: string | null,
): ResolvedSourceDate {
  const candidates = [
    fromProvider(input),
    fromRedditByline(input),
    fromAnchoredPatchTitle(input, patch),
    fromStoredExactUrl(input),
  ];
  for (const candidate of candidates) {
    if (candidate.value && passesGates(candidate.value, patchPublishedAtForGates, nowMs)) {
      return candidate;
    }
  }
  return UNRESOLVED;
}

/**
 * The freshness view: everything except the patch-era floor.
 *
 * Current-patch eligibility is the code that DECIDES whether a pre-era source
 * is stale, so it has to be able to see a pre-era date. Applying the era floor
 * here would blank exactly those dates and turn a confidently stale source into
 * an "unknown freshness" one that gets stored — the opposite of the intent. The
 * other three gates still apply, so a malformed or future-skewed date is null
 * here too and can never buy a source undeserved freshness.
 */
export function resolveAssertedSourceDate(
  input: SourceDateInput,
  patch: SourceDatePatchContext,
  nowMs: number = Date.now(),
): ResolvedSourceDate {
  return resolveInPrecedenceOrder(input, patch, nowMs, null);
}

/**
 * The persistence and display view: all four gates, era floor included.
 *
 * Fails closed when the patch era is unknown — `patchEraFloorMs` is NaN for a
 * null or unparseable publish time — because a date vetted without the floor
 * could be pre-era, and the Brief would apply the real floor later and hide the
 * row. Withholding the date leaves stored state untouched for a later, fully
 * vetted sighting to fill.
 */
export function resolveSourceDate(
  input: SourceDateInput,
  patch: SourceDatePatchContext,
  nowMs: number = Date.now(),
): ResolvedSourceDate {
  if (!Number.isFinite(patchEraFloorMs(patch.publishedAt))) return UNRESOLVED;
  return resolveInPrecedenceOrder(input, patch, nowMs, patch.publishedAt);
}
