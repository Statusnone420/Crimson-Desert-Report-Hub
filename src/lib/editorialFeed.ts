import { editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";
import { SITE_FEED_PATH, SITE_FEED_SUBTITLE, SITE_NAME, SITE_RSS_PATH, SITE_URL } from "@/lib/site";

export const ATOM_CONTENT_TYPE = "application/atom+xml; charset=utf-8";
export const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";
export const FEED_ITEM_LIMIT = 20;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Original Hub reports only, newest first. Wire/press coverage, scanner leads,
 * issues, Observatory, and Watch videos stay out: those are outbound links or
 * other desks, not articles by the Report Hub.
 */
export function feedArticles(
  articles: readonly EditorialArticle[] = editorialArticles,
): EditorialArticle[] {
  return [...articles]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, FEED_ITEM_LIMIT);
}

export function articleCanonicalUrl(article: Pick<EditorialArticle, "path">): string {
  return `${SITE_URL}${article.path}`;
}

export function buildAtomXml(articles: readonly EditorialArticle[] = editorialArticles): string {
  const items = feedArticles(articles);
  const feedUrl = `${SITE_URL}${SITE_FEED_PATH}`;
  const newsUrl = `${SITE_URL}/news`;
  const updated = items[0]?.publishedAt;
  const updatedXml = updated ? `\n  <updated>${escapeXml(updated)}</updated>` : "";
  const entries = items.map((article) => atomEntryXml(article)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(SITE_NAME)}</title>
  <subtitle>${escapeXml(SITE_FEED_SUBTITLE)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${escapeXml(feedUrl)}"/>
  <link rel="alternate" type="text/html" href="${escapeXml(newsUrl)}"/>
  <id>${escapeXml(feedUrl)}</id>${updatedXml}
  <author>
    <name>${escapeXml(SITE_NAME)}</name>
  </author>
${entries}
</feed>
`;
}

export function buildRssXml(articles: readonly EditorialArticle[] = editorialArticles): string {
  const items = feedArticles(articles);
  const rssUrl = `${SITE_URL}${SITE_RSS_PATH}`;
  const newsUrl = `${SITE_URL}/news`;
  const newest = items[0]?.publishedAt;
  const lastBuildDate = newest
    ? `\n    <lastBuildDate>${escapeXml(new Date(newest).toUTCString())}</lastBuildDate>`
    : "";
  const itemXml = items.map((article) => rssItemXml(article)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(newsUrl)}</link>
    <description>${escapeXml(SITE_FEED_SUBTITLE)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(rssUrl)}" rel="self" type="application/rss+xml"/>${lastBuildDate}
${itemXml}
  </channel>
</rss>
`;
}

function atomEntryXml(article: EditorialArticle): string {
  const link = articleCanonicalUrl(article);
  return [
    "  <entry>",
    `    <id>${escapeXml(link)}</id>`,
    `    <title>${escapeXml(article.searchTitle)}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
    `    <updated>${escapeXml(article.publishedAt)}</updated>`,
    `    <published>${escapeXml(article.publishedAt)}</published>`,
    "    <author>",
    `      <name>${escapeXml(SITE_NAME)}</name>`,
    "    </author>",
    `    <category term="${escapeXml(article.section)}"/>`,
    `    <summary>${escapeXml(article.description)}</summary>`,
    "  </entry>",
  ].join("\n");
}

function rssItemXml(article: EditorialArticle): string {
  const link = articleCanonicalUrl(article);
  return [
    "    <item>",
    `      <title>${escapeXml(article.searchTitle)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <description>${escapeXml(article.description)}</description>`,
    `      <pubDate>${escapeXml(new Date(article.publishedAt).toUTCString())}</pubDate>`,
    `      <category>${escapeXml(article.section)}</category>`,
    "    </item>",
  ].join("\n");
}
