import { getEditorialCoverage } from "@/lib/editorialCoverage";
import { editorialSourceById } from "@/lib/editorialSources";

export type WatchStill = {
  src: "/watch/HaCtG1F_hfE.jpg" | "/watch/6H6c0S80d4U.jpg";
  width: 1280;
  height: 720;
  alt: string;
};

export type WatchSelection = {
  id: string;
  kind: "official" | "creator";
  sourceLabel: string;
  kindLabel: "Official" | "Creator commentary";
  headline: string;
  reason: string;
  url: string;
  publishedAt: string | null;
  still: WatchStill;
  actionLabel: string;
};

export const OFFICIAL_REVEAL_URL = "https://www.youtube.com/watch?v=HaCtG1F_hfE";

// Official YouTube is presented on Watch, not in reviewedCoverage: the Pearl Abyss
// source only allows crimsondesert.pearlabyss.com. Disabling khraze-gaming while
// leaving its reviewed item in place fails publication validation (source_disabled).
export const officialWatchSelection = {
  id: "official-reveal",
  kind: "official",
  sourceLabel: "Pearl Abyss",
  kindLabel: "Official",
  headline: "Charting the Unknown — reveal trailer",
  reason: "The reveal introduces the expansion’s offshore adventure and life on land.",
  url: OFFICIAL_REVEAL_URL,
  publishedAt: null,
  still: {
    src: "/watch/HaCtG1F_hfE.jpg",
    width: 1280,
    height: 720,
    alt: "Still from Pearl Abyss’s Charting the Unknown reveal trailer",
  },
  actionLabel: "Watch the official reveal ↗",
} as const satisfies WatchSelection;

const CREATOR_STILLS: Record<string, WatchStill> = {
  "6H6c0S80d4U": {
    src: "/watch/6H6c0S80d4U.jpg",
    width: 1280,
    height: 720,
    alt: "Still from KhrazeGaming’s Charting the Unknown commentary",
  },
};

function videoIdFromWatchUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get("v");
    return parsed.pathname === "/watch" && videoId ? videoId : null;
  } catch {
    return null;
  }
}

function firstReviewedSentence(excerpt: string): string {
  const match = excerpt.match(/^.+?[.](?=\s|$)/);
  return match?.[0] ?? excerpt;
}

export function getWatchSelections(now = new Date()): WatchSelection[] {
  const creators = getEditorialCoverage(now).flatMap((item) => {
    if (item.type !== "video") return [];
    const videoId = videoIdFromWatchUrl(item.url);
    const still = videoId ? CREATOR_STILLS[videoId] : undefined;
    if (!still) throw new Error(`Missing reviewed Watch still for ${item.sourceId}`);
    return [{
      id: item.sourceId,
      kind: "creator" as const,
      sourceLabel: editorialSourceById(item.sourceId)?.label ?? item.sourceId,
      kindLabel: "Creator commentary" as const,
      headline: item.headline,
      reason: firstReviewedSentence(item.excerpt),
      url: item.url,
      publishedAt: item.publishedAt,
      still,
      actionLabel: "Watch on YouTube ↗",
    }];
  });
  return [officialWatchSelection, ...creators];
}
