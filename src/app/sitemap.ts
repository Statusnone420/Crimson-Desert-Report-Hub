import type { MetadataRoute } from "next";
import { editorialArticles } from "@/lib/editorialArticles";
import { SITE_FEED_PATH, SITE_RSS_PATH, SITE_URL } from "@/lib/site";

// Only original articles carry a real modification date. The remaining
// records deliberately omit it rather than treating every deployment as an update.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/news`, changeFrequency: "weekly", priority: 0.9 },
    ...editorialArticles.map((article) => ({
      url: `${SITE_URL}${article.path}`,
      lastModified: article.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/watch`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/patches`, changeFrequency: "hourly", priority: 0.6 },
    { url: `${SITE_URL}/issues`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/observatory`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/report`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}${SITE_FEED_PATH}`, changeFrequency: "weekly", priority: 0.2 },
    { url: `${SITE_URL}${SITE_RSS_PATH}`, changeFrequency: "weekly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
