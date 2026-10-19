import { editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";
import { COLUMN_SECTION, editionDescription, editorialPath, type PublicEdition } from "@/lib/editorials/content";
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

/** What a feed entry needs. Hub articles, rundowns and State of the Game editions all fit it. */
export type FeedEntry = Pick<EditorialArticle, "searchTitle" | "description" | "publishedAt" | "updatedAt" | "section" | "author"> & {
  path: `/${string}`;
};

/** A visible edition as a feed entry, filed under the column's section and signed with its byline. */
export function editionFeedEntry(edition: PublicEdition): FeedEntry {
  return {
    path: editorialPath(edition.slug),
    searchTitle: edition.title,
    description: editionDescription(edition),
    publishedAt: edition.publishAt,
    section: COLUMN_SECTION,
    author: edition.author,
  };
}

/**
 * Hub reports, official patch rundowns and State of the Game editions, newest first.
 * Wire/press coverage, scanner leads, issues, Observatory, and Watch videos stay out:
 * those are outbound links or other desks, not articles by the Report Hub.
 */
export function feedArticles<T extends FeedEntry>(
  articles: readonly T[] = editorialArticles as readonly FeedEntry[] as readonly T[],
): T[] {
  return [...articles]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, FEED_ITEM_LIMIT);
}

export function articleCanonicalUrl(article: Pick<FeedEntry, "path">): string {
  return `${SITE_URL}${article.path}`;
}

function articleUpdatedAt(article: FeedEntry): string {
  return article.updatedAt ?? article.publishedAt;
}

// An edit to an older entry is the feed's latest change, so take the newest revision, not the newest entry.
function latestRevision(items: readonly FeedEntry[]): string | undefined {
  return items
    .map(articleUpdatedAt)
    .reduce<string | undefined>((latest, value) => (!latest || Date.parse(value) > Date.parse(latest) ? value : latest), undefined);
}

export function buildAtomXml(articles: readonly FeedEntry[] = editorialArticles): string {
  const items = feedArticles(articles);
  const feedUrl = `${SITE_URL}${SITE_FEED_PATH}`;
  const newsUrl = `${SITE_URL}/news`;
  const updated = latestRevision(items);
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

export function buildRssXml(articles: readonly FeedEntry[] = editorialArticles): string {
  const items = feedArticles(articles);
  const rssUrl = `${SITE_URL}${SITE_RSS_PATH}`;
  const newsUrl = `${SITE_URL}/news`;
  const newest = latestRevision(items);
  const lastBuildDate = newest
    ? `\n    <lastBuildDate>${escapeXml(new Date(newest).toUTCString())}</lastBuildDate>`
    : "";
  const itemXml = items.map((article) => rssItemXml(article)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
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

function atomEntryXml(article: FeedEntry): string {
  const link = articleCanonicalUrl(article);
  return [
    "  <entry>",
    `    <id>${escapeXml(link)}</id>`,
    `    <title>${escapeXml(article.searchTitle)}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
    `    <updated>${escapeXml(articleUpdatedAt(article))}</updated>`,
    `    <published>${escapeXml(article.publishedAt)}</published>`,
    "    <author>",
    `      <name>${escapeXml(article.author ?? SITE_NAME)}</name>`,
    "    </author>",
    `    <category term="${escapeXml(article.section)}"/>`,
    `    <summary>${escapeXml(article.description)}</summary>`,
    "  </entry>",
  ].join("\n");
}

function rssItemXml(article: FeedEntry): string {
  const link = articleCanonicalUrl(article);
  return [
    "    <item>",
    `      <title>${escapeXml(article.searchTitle)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <description>${escapeXml(article.description)}</description>`,
    `      <pubDate>${escapeXml(new Date(article.publishedAt).toUTCString())}</pubDate>`,
    `      <category>${escapeXml(article.section)}</category>`,
    // RSS <author> requires an email address, so a named byline uses Dublin Core.
    ...(article.author ? [`      <dc:creator>${escapeXml(article.author)}</dc:creator>`] : []),
    "    </item>",
  ].join("\n");
}
