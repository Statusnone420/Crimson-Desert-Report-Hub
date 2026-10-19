import type { MetadataRoute } from "next";
import { editorialPath } from "@/lib/editorials/content";
import { getSitemapEditions } from "@/lib/editorials/store.server";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { patchPath } from "@/lib/patchPublications";
import { SITE_FEED_PATH, SITE_RSS_PATH, SITE_URL } from "@/lib/site";

// Articles and rundowns use their latest revision or publication dates. The remaining
// records deliberately omit it rather than treating every deployment as an update.
// Do not freeze an empty build-time catalogue when CI has no database credentials.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ articles, editions, unavailable }, column] = await Promise.all([getPatchPublications(), getSitemapEditions()]);
  if (unavailable) throw new Error("Patch sitemap temporarily unavailable");
  // A column database problem never breaks the sitemap for the rest of the site
  // (owner decision, 2026-10-18). The gap is logged; editions return on the next read.
  if (column.unavailable) console.warn(JSON.stringify({ event: "feed_partial", feed: "sitemap", unavailable: "editorials" }));
  return [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/news`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/catch-up`, changeFrequency: "weekly", priority: 0.8 },
    ...articles.map((article) => ({
      url: `${SITE_URL}${article.path}`,
      lastModified: article.updatedAt ?? article.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...column.editions.map((edition) => ({
      url: `${SITE_URL}${editorialPath(edition.slug)}`,
      lastModified: edition.publishAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/watch`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/patches`, changeFrequency: "hourly", priority: 0.6 },
    ...editions.map((edition) => ({ url: `${SITE_URL}${patchPath(edition.version)}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${SITE_URL}/issues`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/observatory`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}${SITE_FEED_PATH}`, changeFrequency: "weekly", priority: 0.2 },
    { url: `${SITE_URL}${SITE_RSS_PATH}`, changeFrequency: "weekly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
