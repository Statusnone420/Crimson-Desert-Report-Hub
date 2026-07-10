export const OFFICIAL_NOTICE_LIST_URL = "https://crimsondesert.pearlabyss.com/en-US/News/Notice";
export const OFFICIAL_NOTICE_DETAIL_URL = "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail";

export type OfficialPatchNote = {
  boardNo: string;
  title: string;
  patchVersion: string;
  officialUrl: string;
  publishedAt: string | null;
  summary: string | null;
  claimedFixes: string[];
};

export type OfficialPatchFetchLike = (url: string, init?: { headers?: Record<string, string>; cache?: RequestCache }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // &amp; must be decoded last so "&amp;lt;" resolves to the literal "&lt;",
    // not a double-unescaped "<".
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove HTML tags, looping until the string is stable so a partial match left
// behind by one pass (e.g. "<scr<b>ipt>") cannot survive as a reconstructed tag.
function stripHtmlTags(value: string): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current;
}

function absoluteOfficialUrl(url: string): string {
  return new URL(decodeHtml(url), OFFICIAL_NOTICE_LIST_URL).toString();
}

function boardNoFromUrl(url: string): string | null {
  return new URL(absoluteOfficialUrl(url)).searchParams.get("_boardNo");
}

export function patchVersionFromTitle(title: string): string | null {
  return title.match(/\bPatch Notes Version\s+(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/i)?.[1] ?? null;
}

// Must stay the same shape patchVersionFromTitle extracts, so a manual admin
// override can never store a version the scraper couldn't have produced.
export const PATCH_VERSION_SHAPE = /^\d+\.\d{1,2}(?:\.\d{1,2})?$/;

export function isValidPatchVersion(value: string): boolean {
  return PATCH_VERSION_SHAPE.test(value);
}

export function parseOfficialNoticeList(html: string): Pick<OfficialPatchNote, "boardNo" | "title" | "patchVersion" | "officialUrl"> | null {
  const itemPattern = /<a\s+[^>]*href="([^"]*\/News\/Notice\/Detail\?_boardNo=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(itemPattern)) {
    const rawUrl = match[1];
    const cardHtml = match[2];
    const rawTitle = cardHtml?.match(/<p\s+class="title[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (!rawUrl || !rawTitle) continue;

    const title = decodeHtml(stripHtmlTags(rawTitle));
    const patchVersion = patchVersionFromTitle(title);
    const boardNo = boardNoFromUrl(rawUrl);
    if (!patchVersion || !boardNo) continue;

    return {
      boardNo,
      title,
      patchVersion,
      officialUrl: absoluteOfficialUrl(rawUrl),
    };
  }

  return null;
}

function parseMetaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const content = html.match(pattern)?.[1];
  return content ? decodeHtml(content) : null;
}

function parsePublishedAt(html: string): string | null {
  const raw = html.match(/\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{2}:\d{2})\s+\(UTC\)/)?.[1];
  if (!raw) return null;
  const timestamp = Date.parse(`${raw} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function cleanSummary(value: string): string {
  return value.replace(/([a-z])([A-Z][a-z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

const FIX_LANGUAGE = /\b(fixed|resolved|addressed|corrected|no longer)\b/i;
const IMPROVED_ISSUE_LANGUAGE = /\bimproved\s+an?\s+issue\b/i;

export function parseClaimedFixes(html: string): string[] {
  const fixes: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = decodeHtml(stripHtmlTags(match[1] ?? ""));
    if (!text || text.length < 12 || text.length > 300) continue;
    if (!FIX_LANGUAGE.test(text) && !IMPROVED_ISSUE_LANGUAGE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fixes.push(text);
    if (fixes.length >= 30) break;
  }
  return fixes;
}

export function parseOfficialPatchDetail(
  html: string,
  base: Pick<OfficialPatchNote, "boardNo" | "title" | "patchVersion" | "officialUrl">,
): OfficialPatchNote {
  const title = parseMetaContent(html, "og:title")?.replace(/^\[Updates\]\s*/, "").replace(/\s*\|\s*Crimson Desert$/, "") ?? base.title;
  const patchVersion = patchVersionFromTitle(title) ?? base.patchVersion;
  const summary = parseMetaContent(html, "description") ?? parseMetaContent(html, "og:description");

  return {
    ...base,
    title,
    patchVersion,
    publishedAt: parsePublishedAt(html),
    summary: summary ? cleanSummary(summary).slice(0, 360) : null,
    claimedFixes: parseClaimedFixes(html),
  };
}

async function fetchText(fetcher: OfficialPatchFetchLike, url: string): Promise<string> {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: {
      "user-agent": "CrimsonDesertReportHub/1.0 (+https://crimsonreporthub.com)",
    },
  });
  if (!response.ok) throw new Error(`official patch fetch failed: ${response.status}`);
  return response.text();
}

export async function fetchLatestOfficialPatchNote(options: { fetcher?: OfficialPatchFetchLike } = {}): Promise<OfficialPatchNote | null> {
  const fetcher = options.fetcher ?? (fetch as unknown as OfficialPatchFetchLike);
  const listHtml = await fetchText(fetcher, OFFICIAL_NOTICE_LIST_URL);
  const latest = parseOfficialNoticeList(listHtml);
  if (!latest) return null;

  const detailHtml = await fetchText(fetcher, latest.officialUrl);
  return parseOfficialPatchDetail(detailHtml, latest);
}
