export const OFFICIAL_NOTICE_LIST_URL = "https://crimsondesert.pearlabyss.com/en-US/News/Notice";
export const OFFICIAL_NOTICE_DETAIL_URL = "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail";

export type OfficialPatchNote = {
  boardNo: string;
  title: string;
  patchVersion: string;
  officialUrl: string;
  publishedAt: string | null;
  summary: string | null;
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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
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

export function parseOfficialNoticeList(html: string): Pick<OfficialPatchNote, "boardNo" | "title" | "patchVersion" | "officialUrl"> | null {
  const itemPattern = /<a\s+[^>]*href="([^"]*\/News\/Notice\/Detail\?_boardNo=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(itemPattern)) {
    const rawUrl = match[1];
    const cardHtml = match[2];
    const rawTitle = cardHtml?.match(/<p\s+class="title[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (!rawUrl || !rawTitle) continue;

    const title = decodeHtml(rawTitle.replace(/<[^>]*>/g, ""));
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
