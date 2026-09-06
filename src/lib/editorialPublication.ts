import { editorialSourceById, sourceAllowsHost, type EditorialSourceKind } from "@/lib/editorialSources";

export type EditorialTopic = "base_game" | "expansion";
export type EditorialPublicationType = "article" | "video";

export type EditorialPublicationCandidate = {
  sourceId: string;
  sourceTitle: string;
  reviewedHeadline: string;
  reviewedExcerpt: string | null;
  excerptReviewStatus: "reviewed" | "unreviewed";
  type: EditorialPublicationType;
  topic: EditorialTopic;
  url: string;
  publishedAt: string | null;
  creatorChannelId?: string | null;
};

export type PublicEditorialPublication = {
  sourceId: string;
  sourceKind: EditorialSourceKind;
  sourceTitle: string;
  headline: string;
  excerpt: string;
  type: EditorialPublicationType;
  topic: EditorialTopic;
  url: string;
  publishedAt: string;
};

export type EditorialPublicationRejection =
  | "unknown_source"
  | "source_disabled"
  | "unverified_creator"
  | "invalid_creator_channel"
  | "unverified_creator_video"
  | "invalid_type"
  | "invalid_url"
  | "disallowed_host"
  | "duplicate_url"
  | "missing_publication_time"
  | "invalid_publication_time"
  | "invalid_title"
  | "missing_reviewed_excerpt"
  | "unreviewed_excerpt"
  | "boilerplate"
  | "not_crimson_desert";

export type EditorialPublicationValidation =
  | { ok: true; publication: PublicEditorialPublication }
  | { ok: false; reason: EditorialPublicationRejection };

const BOILERPLATE = /\b(cookie policy|privacy policy|terms of (?:use|service)|subscribe to our newsletter|sign in to continue|airbnb|avatar|skip to main|image\s*\d+|more replies)\b/i;
const TRACKING_QUERY_KEY = /^(?:utm_.+|gclid|fbclid|mc_[ce]id)$/i;
const HTML_LIKE = /<[^>]+>/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanText(value: string, maximumLength: number): string | null {
  const normalized = normalizeText(value);
  return normalized && normalized.length <= maximumLength && !HTML_LIKE.test(normalized) ? normalized : null;
}

export function canonicalEditorialUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !parsed.hostname) return null;
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  parsed.hash = "";
  parsed.port = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_QUERY_KEY.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function validPublicationTime(value: string, now: Date): boolean {
  if (DATE_ONLY.test(value)) {
    const date = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() <= now.getTime();
  }
  if (!UTC_INSTANT.test(value)) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() > now.getTime()) return false;
  return instant.toISOString() === value || instant.toISOString().replace(".000Z", "Z") === value;
}

function canonicalCreatorVideoUrl(value: string): string | null {
  const canonical = canonicalEditorialUrl(value);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const videoId = parsed.searchParams.get("v");
  if (parsed.pathname !== "/watch" || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  parsed.search = "";
  parsed.searchParams.set("v", videoId);
  return parsed.toString();
}

export function validateEditorialPublication(
  candidate: EditorialPublicationCandidate,
  options: { knownCanonicalUrls?: Iterable<string>; now?: Date } = {},
): EditorialPublicationValidation {
  const source = editorialSourceById(candidate.sourceId);
  if (!source) return { ok: false, reason: "unknown_source" };
  if (!source.enabled) return { ok: false, reason: "source_disabled" };
  if (source.kind === "creator" && !source.verifiedChannelId) return { ok: false, reason: "unverified_creator" };
  if (source.kind === "creator" && candidate.type !== "video") return { ok: false, reason: "invalid_type" };
  if (source.kind === "creator" && candidate.creatorChannelId !== source.verifiedChannelId) {
    return { ok: false, reason: "invalid_creator_channel" };
  }

  const url = source.kind === "creator" ? canonicalCreatorVideoUrl(candidate.url) : canonicalEditorialUrl(candidate.url);
  if (!url) return { ok: false, reason: "invalid_url" };
  if (!sourceAllowsHost(source, new URL(url).hostname)) return { ok: false, reason: "disallowed_host" };
  const videoId = new URL(url).searchParams.get("v");
  if (source.kind === "creator" && (!videoId || !source.verifiedVideoIds?.includes(videoId))) {
    return { ok: false, reason: "unverified_creator_video" };
  }
  const knownUrls = new Set(
    [...options.knownCanonicalUrls ?? []]
      .map(canonicalEditorialUrl)
      .filter((known): known is string => known !== null),
  );
  if (knownUrls.has(url)) return { ok: false, reason: "duplicate_url" };

  if (!candidate.publishedAt?.trim()) return { ok: false, reason: "missing_publication_time" };
  const publishedAt = candidate.publishedAt.trim();
  if (!validPublicationTime(publishedAt, options.now ?? new Date())) return { ok: false, reason: "invalid_publication_time" };

  const sourceTitle = cleanText(candidate.sourceTitle, 240);
  const headline = cleanText(candidate.reviewedHeadline, 240);
  if (!sourceTitle || !headline) return { ok: false, reason: "invalid_title" };
  if (!candidate.reviewedExcerpt?.trim()) return { ok: false, reason: "missing_reviewed_excerpt" };
  if (candidate.excerptReviewStatus !== "reviewed") return { ok: false, reason: "unreviewed_excerpt" };
  const excerpt = cleanText(candidate.reviewedExcerpt, 500);
  if (!excerpt || BOILERPLATE.test(sourceTitle) || BOILERPLATE.test(headline) || BOILERPLATE.test(excerpt)) {
    return { ok: false, reason: "boilerplate" };
  }
  if (!/\b(?:crimson\s+desert|charting\s+the\s+unknown)\b/i.test(sourceTitle)) {
    return { ok: false, reason: "not_crimson_desert" };
  }

  return {
    ok: true,
    publication: {
      sourceId: source.id,
      sourceKind: source.kind,
      sourceTitle,
      headline,
      excerpt,
      type: candidate.type,
      topic: candidate.topic,
      url,
      publishedAt,
    },
  };
}
