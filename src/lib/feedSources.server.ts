import "server-only";

import { editionFeedEntry, type FeedEntry } from "@/lib/editorialFeed";
import { getPublicEditions } from "@/lib/editorials/store.server";
import { getPatchPublications } from "@/lib/patchPublications.server";

export type FeedSource = "patches" | "editorials";
export type FeedName = "atom" | "rss";

/** A partial feed is re-fetched within a minute, so a missing source never sticks. */
export const PARTIAL_FEED_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const FEED_UNAVAILABLE_HEADER = "X-Feed-Unavailable";

/**
 * Patch rundowns and column editions, read separately. A column database problem must
 * never take down the patch feed, and the reverse (owner decision, 2026-10-18). When one
 * read fails, the other is served and the gap is logged with a safe code, named in a
 * response header and kept out of long caches. Before the column's migration, no
 * editions is the normal path and is not reported.
 */
export async function readFeedSources(feed: FeedName): Promise<{ entries: FeedEntry[]; unavailable: FeedSource[] }> {
  const [patches, column] = await Promise.all([getPatchPublications(), getPublicEditions()]);
  const unavailable: FeedSource[] = [
    ...(patches.unavailable ? ["patches" as const] : []),
    ...(column.unavailable ? ["editorials" as const] : []),
  ];
  if (unavailable.length === 1) console.warn(JSON.stringify({ event: "feed_partial", feed, unavailable: unavailable[0] }));
  return { entries: [...patches.articles, ...column.editions.map(editionFeedEntry)], unavailable };
}

/** Headers for a feed that is missing one source; none for a complete feed. */
export function partialFeedHeaders(unavailable: readonly FeedSource[]): Record<string, string> {
  return unavailable.length ? { [FEED_UNAVAILABLE_HEADER]: unavailable.join(", "), "Cache-Control": PARTIAL_FEED_CACHE_CONTROL } : {};
}
