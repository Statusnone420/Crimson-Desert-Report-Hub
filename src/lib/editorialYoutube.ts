import { XMLParser, XMLValidator } from "fast-xml-parser";

const YOUTUBE_NAMESPACE = "http://www.youtube.com/xml/schemas/2015";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PUBLISHED_AT =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const TITLE_MARKERS = [/\bcrimson\s+desert\b/i, /\bcharting\s+the\s+unknown\b/i];

export type EditorialYoutubeCandidate = {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: string;
  url: string;
};

export type EditorialYoutubeErrorCode =
  | "invalid_channel_id"
  | "timeout"
  | "fetch_failed"
  | "http_error"
  | "oversize"
  | "malformed_feed";

export class EditorialYoutubeError extends Error {
  readonly code: EditorialYoutubeErrorCode;
  readonly status: number | null;

  constructor(code: EditorialYoutubeErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "EditorialYoutubeError";
    this.code = code;
    this.status = status;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type FeedEntry = {
  "yt:channelId"?: unknown;
  "yt:videoId"?: unknown;
  title?: unknown;
  published?: unknown;
  link?: unknown;
};

function malformed(message: string): EditorialYoutubeError {
  return new EditorialYoutubeError("malformed_feed", `YouTube Atom feed malformed: ${message}`);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validCalendarDate(value: string): boolean {
  const match = value.match(PUBLISHED_AT);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

function canonicalPublishedAt(value: string): string | null {
  if (!validCalendarDate(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function canonicalVideoUrl(href: string, videoId: string): string | null {
  try {
    const authority = href.match(/^https:\/\/([^/]+)/i)?.[1] ?? "";
    if (authority.includes("@") || authority.includes(":")) return null;
    const url = new URL(href);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/watch" ||
      url.hash
    ) return null;
    if (url.searchParams.get("v") !== videoId || [...url.searchParams.keys()].some((key) => key !== "v")) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

function isEditorialTitle(title: string): boolean {
  return TITLE_MARKERS.some((marker) => marker.test(title));
}

function parseCandidates(xml: string, allowedChannelId: string): EditorialYoutubeCandidate[] {
  if (/<!DOCTYPE\b|<!--|<!\[CDATA\[/i.test(xml)) throw malformed("DOCTYPE, comments, and CDATA are unsupported");
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw malformed(validation.err.msg);

  let parsed: { feed?: { [key: string]: unknown } };
  try {
    parsed = new XMLParser({
      allowBooleanAttributes: false,
      attributeNamePrefix: "@_",
      ignoreAttributes: false,
      ignoreDeclaration: true,
      maxNestedTags: 32,
      parseAttributeValue: false,
      parseTagValue: false,
      processEntities: true,
      removeNSPrefix: false,
      trimValues: true,
      isArray: (tagName) => tagName === "entry" || tagName === "link",
    }).parse(xml) as { feed?: { [key: string]: unknown } };
  } catch (error) {
    throw malformed(error instanceof Error ? error.message : String(error));
  }

  const feed = parsed.feed;
  if (!feed || Array.isArray(feed) || typeof feed !== "object") throw malformed("root element must be <feed>");
  if (feed["@_xmlns:yt"] !== YOUTUBE_NAMESPACE) throw malformed("the YouTube namespace is missing or unsupported");
  const entries = feed.entry;
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw malformed("feed entries have an unsupported shape");

  const candidates: EditorialYoutubeCandidate[] = [];
  const seen = new Set<string>();
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) throw malformed("entry has an unsupported shape");
    const entry = rawEntry as FeedEntry;
    const channelId = textValue(entry["yt:channelId"]);
    const videoId = textValue(entry["yt:videoId"]);
    const title = textValue(entry.title);
    const publishedAt = canonicalPublishedAt(textValue(entry.published));
    const links = Array.isArray(entry.link) ? entry.link : [];
    const alternate = links.find(
      (link) => link && typeof link === "object" && (link as { "@_rel"?: unknown })["@_rel"] === "alternate",
    ) as { "@_href"?: unknown } | undefined;
    const url = alternate ? canonicalVideoUrl(textValue(alternate["@_href"]), videoId) : null;
    if (
      channelId !== allowedChannelId ||
      !CHANNEL_ID.test(channelId) ||
      !VIDEO_ID.test(videoId) ||
      !publishedAt ||
      !url ||
      !isEditorialTitle(title)
    ) continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    candidates.push({ videoId, channelId, title, publishedAt, url });
  }
  return candidates;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > maxBytes) {
    throw new EditorialYoutubeError("oversize", `YouTube Atom feed exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new EditorialYoutubeError("oversize", `YouTube Atom feed exceeds the ${maxBytes}-byte limit`);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new EditorialYoutubeError("oversize", `YouTube Atom feed exceeds the ${maxBytes}-byte limit`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function discoverEditorialYoutube(options: {
  allowedChannelId: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<EditorialYoutubeCandidate[]> {
  const { allowedChannelId } = options;
  if (!CHANNEL_ID.test(allowedChannelId)) throw new EditorialYoutubeError("invalid_channel_id", "Allowed YouTube channel ID is invalid");
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${allowedChannelId}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new EditorialYoutubeError("timeout", `YouTube Atom feed request exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(feedUrl, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/atom+xml, application/xml;q=0.9" },
      }),
      timeout,
    ]);
    if (!response.ok) throw new EditorialYoutubeError("http_error", `YouTube Atom feed returned HTTP ${response.status}`, response.status);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !/(?:application|text)\/(?:atom\+xml|xml)(?:;|$)/.test(contentType)) {
      throw malformed(`unexpected content type ${contentType}`);
    }
    const body = await Promise.race([readBoundedBody(response, maxBytes), timeout]);
    return parseCandidates(body, allowedChannelId);
  } catch (error) {
    if (error instanceof EditorialYoutubeError) throw error;
    if (timedOut || controller.signal.aborted) throw new EditorialYoutubeError("timeout", `YouTube Atom feed request exceeded ${timeoutMs}ms`);
    throw new EditorialYoutubeError("fetch_failed", `YouTube Atom feed request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
