import { CRIMSON_DESERT_STEAM_APP_ID } from "@/lib/automation/steam";
import { parseClaimedFixes, patchVersionFromTitle, type OfficialPatchFetchLike, type OfficialPatchNote } from "@/lib/officialPatch";

// Steam's free news API, limited to the official announcement feed: the posts
// the publisher writes on the game's Steam page, not press items Steam imports.
export const STEAM_PATCH_NEWS_URL = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=" +
  `${CRIMSON_DESERT_STEAM_APP_ID}&count=20&maxlength=0&feeds=steam_community_announcements&format=json`;
const STEAM_NEWS_PAGE_URL = `https://store.steampowered.com/news/app/${CRIMSON_DESERT_STEAM_APP_ID}/view/`;
const ANNOUNCEMENT_FEED = "steam_community_announcements";

// Announcements are BBCode. List items become <li> so the claim parser reads a
// Steam post exactly as it reads the Pearl Abyss page; other tags are dropped.
const BBCODE_TAG = /\[\/?(?:p|b|i|u|s|strike|h[1-6]|list|olist|hr|url|img|code|quote|spoiler|noparse|table|tr|th|td|previewyoutube|dynamiclink|video)(?:[= ][^\]]*)?\]/gi;

function bbcodeAsListHtml(contents: string): string {
  return contents.replace(/\[\*\]/g, "<li>").replace(/\[\/\*\]/g, "</li>").replace(BBCODE_TAG, " ");
}

type SteamNewsItem = { gid?: unknown; title?: unknown; contents?: unknown; date?: unknown; feedname?: unknown };

function versionParts(version: string): number[] {
  return version.split(".").map(Number);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * The highest-versioned "Patch Notes Version x.y.z" post in the official
 * announcement feed, as an official patch note. Its board number is
 * `steam-<gid>`, so it never collides with a Pearl Abyss board number. Returns
 * null when the feed holds no patch notes; throws on a malformed response.
 */
export function parseSteamPatchNews(payload: unknown): OfficialPatchNote | null {
  const items = (payload as { appnews?: { newsitems?: unknown } } | null)?.appnews?.newsitems;
  if (!Array.isArray(items)) throw new Error("Steam patch news response was malformed");

  let latest: { gid: string; title: string; contents: string; date: number; patchVersion: string } | null = null;
  for (const item of items as SteamNewsItem[]) {
    if (!item || typeof item !== "object" || item.feedname !== ANNOUNCEMENT_FEED) continue;
    const { gid, title, contents, date } = item;
    if (typeof gid !== "string" || !/^\d+$/.test(gid) || typeof title !== "string" || typeof contents !== "string") continue;
    if (typeof date !== "number" || !Number.isSafeInteger(date) || date <= 0) continue;
    const patchVersion = patchVersionFromTitle(title);
    if (!patchVersion) continue;
    if (!latest || compareVersions(patchVersion, latest.patchVersion) > 0 ||
      (compareVersions(patchVersion, latest.patchVersion) === 0 && date > latest.date)) {
      latest = { gid, title: title.trim(), contents, date, patchVersion };
    }
  }
  if (!latest) return null;

  const { fixes, totalFixLines } = parseClaimedFixes(bbcodeAsListHtml(latest.contents));
  return {
    boardNo: `steam-${latest.gid}`,
    title: latest.title,
    patchVersion: latest.patchVersion,
    officialUrl: `${STEAM_NEWS_PAGE_URL}${latest.gid}`,
    publishedAt: new Date(latest.date * 1000).toISOString(),
    summary: null,
    claimedFixes: fixes,
    claimedFixTotal: totalFixLines,
  };
}

export async function fetchLatestSteamPatchNote(options: { fetcher?: OfficialPatchFetchLike } = {}): Promise<OfficialPatchNote | null> {
  const fetcher = options.fetcher ?? (fetch as unknown as OfficialPatchFetchLike);
  const response = await fetcher(STEAM_PATCH_NEWS_URL, {
    cache: "no-store",
    headers: { "user-agent": "CrimsonDesertReportHub/1.0 (+https://crimsonreporthub.com)" },
  });
  if (!response.ok) throw new Error(`Steam patch news fetch failed: ${response.status}`);
  return parseSteamPatchNews(JSON.parse(await response.text()));
}

/** True when the URL is the page of a Steam post that `parseSteamPatchNews` records. */
export function isSteamPatchNoteUrl(url: string): boolean {
  return url.startsWith(STEAM_NEWS_PAGE_URL);
}

/** True when `candidate` is a strictly newer patch version than every known version. */
export function isNewerPatchVersion(candidate: string, known: (string | null | undefined)[]): boolean {
  return known.every((version) => !version || compareVersions(candidate, version) > 0);
}
