import { utcDay } from "@/lib/activityHistory";
import { CATCH_UP_MILESTONES, type CatchUpMilestone } from "@/lib/catchUpContent";
import { parseYouTubeVideoUrl } from "@/lib/youtubeVideoUrl";

const DAY_MS = 86_400_000;

/** The expansion the front page counts down to and the desk follows, by its release id on the timeline. */
export const EXPANSION = { id: "charting-the-unknown", name: "Charting the Unknown", path: "/topics/charting-the-unknown" } as const;

/** Days after release that the front page leads with the launch watch. */
export const LAUNCH_WATCH_DAYS = 7;

/**
 * What no expansion notice on the timeline has said, as of `checkedAt`. A test fails once a newer
 * notice joins the timeline, so the list is checked against it before it ships.
 */
export const NOT_SAID_YET = {
  checkedAt: "2026-10-21",
  items: [
    { text: "How long the new content takes to play." },
    { text: "The download size." },
    {
      text: "A Mac date. The expansion won’t be on the Mac App Store at launch, and Pearl Abyss says it will make a separate announcement if a Mac release is planned.",
      source: { label: "Pearl Abyss · pre-order notice", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129" },
    },
  ],
} as const;

/** A store's listed price, checked by hand. Pearl Abyss's notices give none, so it is sourced to the store. */
export const STORE_PRICE = {
  text: "$24.99 on Steam (US store)",
  note: "Other stores and regions may differ.",
  checkedAt: "2026-10-21",
  source: { label: "Steam store page", url: "https://store.steampowered.com/app/5001840/" },
} as const;

export type VideoStill = { src: `/${string}`; width: number; height: number };

/** Local covers for the videos the desk plays in place, recorded in public/watch/sources.json. Others stay links. */
export const VIDEO_STILLS: Readonly<Record<string, VideoStill>> = {
  k9WnZqkAFis: { src: "/watch/k9WnZqkAFis.jpg", width: 1280, height: 720 },
  er6wiBEXYYs: { src: "/watch/er6wiBEXYYs.jpg", width: 720, height: 900 },
};

/** The expansion's notices the Hub had at `now`, newest first: those that set its date and those about it. */
export function expansionNotices(now: number, milestones: readonly CatchUpMilestone[] = CATCH_UP_MILESTONES): CatchUpMilestone[] {
  return milestones
    .filter((item) => (item.release?.id === EXPANSION.id || item.about === EXPANSION.id) && Date.parse(item.publishedAt) <= now)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** The release time the newest notice sets. A later notice for the same release replaces an earlier date. */
export function expansionRelease(notices: readonly CatchUpMilestone[]): { at: string; notice: CatchUpMilestone } | null {
  const notice = notices.find((item) => item.release?.id === EXPANSION.id && Number.isFinite(Date.parse(item.release.at)));
  return notice?.release ? { at: notice.release.at, notice } : null;
}

/** Whole UTC calendar days between two instants, so the count matches the UTC date printed beside it. */
export function utcDaysBetween(from: number, to: number): number {
  return Math.round((Date.parse(`${utcDay(to)}T00:00:00Z`) - Date.parse(`${utcDay(from)}T00:00:00Z`)) / DAY_MS);
}

export type LaunchState =
  | { phase: "countdown"; at: string; days: number }
  | { phase: "watch"; at: string }
  | { phase: "out"; at: string };

/** A countdown before release, the launch watch for launch week, then plain "out". */
export function launchState(at: string, now: number): LaunchState | null {
  const release = Date.parse(at);
  if (!Number.isFinite(release) || !Number.isFinite(now)) return null;
  if (now < release) return { phase: "countdown", at, days: utcDaysBetween(now, release) };
  return now < release + LAUNCH_WATCH_DAYS * DAY_MS ? { phase: "watch", at } : { phase: "out", at };
}

/** The launch state from the timeline as the Hub had it at `now`; null when no notice sets a date. */
export function currentLaunch(now: number, milestones: readonly CatchUpMilestone[] = CATCH_UP_MILESTONES): LaunchState | null {
  const release = expansionRelease(expansionNotices(now, milestones));
  return release ? launchState(release.at, now) : null;
}

/** "in 8 days", "tomorrow" or "today", counted in UTC calendar days. */
export function countdownWords(days: number): string {
  return days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : "today";
}

export type ExpansionVideo = { label: string; url: string; videoId: string; publishedAt: string | null };

/** The YouTube videos the expansion's notices link, in notice order, each once. */
export function expansionVideos(notices: readonly CatchUpMilestone[]): ExpansionVideo[] {
  const seen = new Set<string>();
  return notices.flatMap((notice) => [notice.source, ...(notice.related ?? [])].flatMap((link) => {
    const video = parseYouTubeVideoUrl(link.url);
    if (!video.ok || seen.has(video.videoId)) return [];
    seen.add(video.videoId);
    return [{ label: link.label, url: link.url, videoId: video.videoId, publishedAt: notice.publishedAt }];
  }));
}
