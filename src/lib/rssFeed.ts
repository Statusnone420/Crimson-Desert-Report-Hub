import { editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";
import { SITE_DESCRIPTION, SITE_FEED_PATH, SITE_NAME, SITE_URL } from "@/lib/site";

export const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * RSS 2.0 of original Hub reports. Wire/press coverage and scanner leads stay
 * out: those are outbound source links, not articles by the Report Hub.
 */
export function buildRssXml(articles: readonly EditorialArticle[] = editorialArticles): string {
  const items = [...articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const newest = items[0]?.publishedAt;
  const feedUrl = `${SITE_URL}${SITE_FEED_PATH}`;
  const itemXml = items.map((article) => rssItemXml(article)).join("\n");
  const lastBuildDate = newest
    ? `\n    <lastBuildDate>${escapeXml(new Date(newest).toUTCString())}</lastBuildDate>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>${lastBuildDate}
${itemXml}
  </channel>
</rss>
`;
}

function rssItemXml(article: EditorialArticle): string {
  const link = `${SITE_URL}${article.path}`;
  return [
    "    <item>",
    `      <title>${escapeXml(article.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <description>${escapeXml(article.description)}</description>`,
    `      <pubDate>${escapeXml(new Date(article.publishedAt).toUTCString())}</pubDate>`,
    "    </item>",
  ].join("\n");
}
