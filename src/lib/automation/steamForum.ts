import { CRIMSON_DESERT_STEAM_APP_ID } from "@/lib/automation/steam";

/**
 * The game's Steam Community General Discussions forum, read directly. Each topic
 * row carries the thread title, a preview of the opening post, the opening post's
 * time and the last reply's Unix timestamp, so a thread can be screened without
 * a paid search or page extract. Rows are ordered by last reply.
 */
export const STEAM_FORUM_URL = `https://steamcommunity.com/app/${CRIMSON_DESERT_STEAM_APP_ID}/discussions/0/`;

const FORUM_THREAD_PATH = new RegExp(`^/app/${CRIMSON_DESERT_STEAM_APP_ID}/discussions/\\d+/(\\d+)/?$`);

/**
 * The topic id of a thread in one of the game's Steam Community forums, the same
 * on every comment page of it (`?ctp=2`), or null for any other page.
 */
export function steamForumTopicId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, "") !== "steamcommunity.com") return null;
    return url.pathname.match(FORUM_THREAD_PATH)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * A thread in one of the game's Steam Community forums. A guide, a forum's own
 * index or another game's page shares the domain but is not a thread.
 */
export function isSteamForumThreadUrl(value: unknown): boolean {
  return steamForumTopicId(value) !== null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SteamForumTopic = {
  topicId: string;
  url: string;
  title: string;
  preview: string;
  /** Opening post time, as UTC ISO, when Steam's display string was read. */
  postedAt: string | null;
  /**
   * "missing" when the row carries no opening-post time, "malformed" when it
   * carries one that cannot be read; `postedText` keeps the unread string.
   */
  postedAtStatus: "ok" | "missing" | "malformed";
  postedText: string;
  lastPostAt: string;
  replyCount: number;
  sticky: boolean;
  /** Keyed hash of the opening post's author, or null. The name itself is never kept. */
  authorKey: string | null;
};

/** Turns an author's display name into a keyed hash; see forumAuthorKey. */
export type AuthorKeyer = (displayName: string) => string | null;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Steam shows the opening post time as "9:15am" (today), "Oct 3 @ 11:18pm" (this
 * year) or "Dec 30, 2025 @ 4:02pm". The fetch asks for UTC rendering, so the
 * string is read as UTC against the fetch time. A yearless date that would land
 * more than a day in the future belongs to the previous year.
 */
export function parseSteamForumTime(value: string, now: Date): string | null {
  const match = value.trim().toLowerCase().match(
    /^(?:([a-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?\s*@\s*)?(\d{1,2}):(\d{2})\s*(am|pm)$/,
  );
  if (!match) return null;
  const [, monthName, dayText, yearText, hourText, minuteText, meridiem] = match;
  const clockHour = Number(hourText);
  if (clockHour < 1 || clockHour > 12) return null;
  let hour = clockHour % 12;
  if (meridiem === "pm") hour += 12;
  const minute = Number(minuteText);
  if (minute > 59) return null;
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();
  if (monthName) {
    month = MONTHS.indexOf(monthName);
    if (month < 0) return null;
    day = Number(dayText);
    if (yearText) year = Number(yearText);
  }
  let time = Date.UTC(year, month, day, hour, minute);
  const parsed = new Date(time);
  if (parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) return null;
  if (monthName && !yearText && time > now.getTime() + 24 * 60 * 60 * 1000) {
    time = Date.UTC(year - 1, month, day, hour, minute);
  }
  return new Date(time).toISOString();
}

export function parseSteamForumTopics(html: string, now: Date, authorKey: AuthorKeyer = () => null): SteamForumTopic[] {
  const topics: SteamForumTopic[] = [];
  const blocks = html.split(/<div\b[^>]*\bclass="forum_topic\b/).slice(1);
  for (const block of blocks) {
    const classes = block.slice(0, block.indexOf("\"")).trim().split(/\s+/);
    const topicId = block.match(/data-gidforumtopic="(\d+)"/)?.[1];
    const href = block.match(/class="forum_topic_overlay"\s+href="([^"]+)"/)?.[1];
    const lastPost = block.match(/class="forum_topic_lastpost"[^>]*data-timestamp="(\d+)"/)?.[1];
    const titleHtml = block.match(/<div class="forum_topic_name[^"]*">([\s\S]*?)<\/div>/)?.[1];
    if (!topicId || !href || !lastPost || titleHtml === undefined) continue;
    const url = decodeEntities(href);
    if (!url.startsWith(STEAM_FORUM_URL) || !url.includes(topicId)) continue;
    const title = textOf(titleHtml);
    if (!title) continue;
    // The hover card is HTML escaped inside an attribute: decode it once to read it.
    const tooltip = decodeEntities(block.match(/data-tooltip-forum="([^"]*)"/)?.[1] ?? "");
    const preview = textOf(tooltip.match(/<div class="topic_hover_text">([\s\S]*?)<\/div>/)?.[1] ?? "");
    // Read only the dedicated "Posted by" metadata row. The opening-post preview
    // can itself contain "Posted by:", and the "Last post" row carries the last
    // reply's time; neither may stand in for the opening post's time.
    const postedRow = tooltip.match(/<div class="topic_hover_row">\s*Posted by:([\s\S]*?)<\/div>/)?.[1] ?? "";
    const postedText = postedRow.match(/<\/span>\s*,\s*<span[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    const authorName = textOf(postedRow.match(/^\s*<span[^>]*>([\s\S]*?)<\/span>\s*,/)?.[1] ?? "");
    const replyText = block.match(/class="forum_topic_reply_count">[\s\S]*?(\d[\d,]*)\s*<\/div>/)?.[1] ?? "0";
    const postedDisplay = decodeEntities(postedText).trim();
    const postedAt = postedDisplay ? parseSteamForumTime(postedDisplay, now) : null;
    topics.push({
      topicId,
      url,
      title,
      preview,
      postedAt,
      postedAtStatus: !postedDisplay ? "missing" : postedAt ? "ok" : "malformed",
      postedText: postedDisplay,
      lastPostAt: new Date(Number(lastPost) * 1000).toISOString(),
      replyCount: Number(replyText.replace(/,/g, "")),
      sticky: classes.includes("sticky"),
      authorKey: authorName ? authorKey(authorName) : null,
    });
  }
  return topics;
}

/**
 * Read forum pages newest-reply first until a page reaches threads last active
 * before `since`. Pinned threads are skipped: they are moderator notices, and
 * their places at the top of every page say nothing about recent activity.
 */
export async function fetchSteamForumTopics({
  since,
  now,
  maxPages,
  fetchImpl = fetch,
  authorKey,
}: { since: Date; now: Date; maxPages: number; fetchImpl?: FetchLike; authorKey?: AuthorKeyer }): Promise<SteamForumTopic[]> {
  const found = new Map<string, SteamForumTopic>();
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(STEAM_FORUM_URL);
    if (page > 1) url.searchParams.set("fp", String(page));
    const response = await fetchImpl(url, {
      // Without this cookie Steam renders the opening post time in Pacific time.
      headers: { accept: "text/html", cookie: "timezoneOffset=0,0" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Steam forum request failed (${response.status})`);
    const topics = parseSteamForumTopics(await response.text(), now, authorKey).filter((topic) => !topic.sticky);
    if (page === 1 && topics.length === 0) throw new Error("Steam forum page had no readable topics");
    let reachedOlder = topics.length === 0;
    for (const topic of topics) {
      if (Date.parse(topic.lastPostAt) < since.getTime()) {
        reachedOlder = true;
        continue;
      }
      if (!found.has(topic.topicId)) found.set(topic.topicId, topic);
    }
    if (reachedOlder) break;
  }
  return [...found.values()];
}

export type SteamThreadPage = {
  /** Newest post time on this page, in ms, or null when none could be read. */
  latestMs: number | null;
  /** From "Showing 1 - 15 of 71 comments": first and last reply shown, and the total. */
  shown: { from: number; to: number; total: number } | null;
};

/**
 * Reads one page of a Steam thread: every post carries a Unix
 * `data-timestamp`, and the paging summary says which replies the page shows
 * out of how many. Steam draws the page links with script, so the summary is
 * the only way to find the last page.
 */
export function parseSteamThreadPage(html: string): SteamThreadPage {
  const stamps = [...html.matchAll(/commentthread_comment_timestamp"[^>]*?data-timestamp="(\d{9,11})"/g)]
    .map((match) => Number(match[1]) * 1000)
    .filter(Number.isFinite);
  const at = html.indexOf("forum_paging_summary");
  const summary = at < 0 ? "" : html.slice(at, at + 600).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const counts = summary.match(/Showing\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)/i);
  const number = (value: string) => Number(value.replace(/,/g, ""));
  return {
    latestMs: stamps.length ? Math.max(...stamps) : null,
    shown: counts ? { from: number(counts[1]), to: number(counts[2]), total: number(counts[3]) } : null,
  };
}

async function readSteamThreadPage(url: URL, fetchImpl: FetchLike): Promise<SteamThreadPage | null> {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", cookie: "timezoneOffset=0,0" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return parseSteamThreadPage(await response.text());
}

/**
 * The latest reply in a Steam thread, as UTC ISO, or null when it cannot be
 * read. A search result carries only a thread's opening date, so a thread that
 * players are still answering looks as old as its first post. This reads the
 * first page and, when the thread runs longer, its last page (`?ctp=N`): at
 * most two free public page reads. A time more than a day ahead of `now` is
 * ignored, the same skew bound the forum reader uses.
 */
export async function fetchSteamThreadLatestReply(
  threadUrl: string,
  { now, fetchImpl = fetch }: { now: Date; fetchImpl?: FetchLike },
): Promise<string | null> {
  if (!isSteamForumThreadUrl(threadUrl)) return null;
  const first = await readSteamThreadPage(new URL(threadUrl), fetchImpl);
  if (!first) return null;
  const times = first.latestMs === null ? [] : [first.latestMs];
  const shown = first.shown;
  if (shown && shown.to >= shown.from && shown.total > shown.to) {
    const lastPage = Math.ceil(shown.total / (shown.to - shown.from + 1));
    const url = new URL(threadUrl);
    url.searchParams.set("ctp", String(lastPage));
    const last = await readSteamThreadPage(url, fetchImpl);
    if (last?.latestMs !== null && last?.latestMs !== undefined) times.push(last.latestMs);
  }
  const latest = times.filter((time) => time <= now.getTime() + 24 * 60 * 60 * 1000);
  return latest.length ? new Date(Math.max(...latest)).toISOString() : null;
}
