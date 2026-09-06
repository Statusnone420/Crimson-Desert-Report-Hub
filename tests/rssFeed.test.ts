import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/rss.xml/route";
import { chartingTheUnknown, editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";
import { getEditorialCoverage } from "@/lib/editorialCoverage";
import { buildRssXml, escapeXml, RSS_CONTENT_TYPE } from "@/lib/rssFeed";
import { SITE_DESCRIPTION, SITE_FEED_PATH, SITE_NAME, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";

function article(overrides: Partial<EditorialArticle> = {}): EditorialArticle {
  return {
    ...chartingTheUnknown,
    ...overrides,
  };
}

describe("RSS feed of original Hub reports", () => {
  it("escapes XML special characters in text and attributes", () => {
    expect(escapeXml(`A & B <C> "D" 'E'`)).toBe("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
    const xml = buildRssXml([
      article({
        title: `Pywel & the <islands>`,
        description: `Ships, sunken ruins & "housing"`,
      }),
    ]);
    expect(xml).toContain("<title>Pywel &amp; the &lt;islands&gt;</title>");
    expect(xml).toContain("<description>Ships, sunken ruins &amp; &quot;housing&quot;</description>");
    expect(xml).not.toContain("Pywel & the");
    expect(xml).not.toContain("<islands>");
  });

  it("emits RSS 2.0 for each editorial article with an absolute canonical URL", () => {
    const xml = buildRssXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain(`<title>${SITE_NAME}</title>`);
    expect(xml).toContain(`<link>${SITE_URL}</link>`);
    expect(xml).toContain(`<description>${SITE_DESCRIPTION}</description>`);
    expect(xml).toContain(
      `<atom:link href="${SITE_URL}${SITE_FEED_PATH}" rel="self" type="application/rss+xml"/>`,
    );
    expect(xml.match(/<item>/g)?.length).toBe(editorialArticles.length);
    for (const report of editorialArticles) {
      const link = `${SITE_URL}${report.path}`;
      expect(xml).toContain(`<title>${escapeXml(report.title)}</title>`);
      expect(xml).toContain(`<link>${link}</link>`);
      expect(xml).toContain(`<guid isPermaLink="true">${link}</guid>`);
      expect(xml).toContain(`<description>${escapeXml(report.description)}</description>`);
      expect(xml).toContain(`<pubDate>${new Date(report.publishedAt).toUTCString()}</pubDate>`);
    }
  });

  it("keeps outbound wire coverage and scanner leads out of the feed", () => {
    const xml = buildRssXml();
    expect(xml).not.toContain("pcgamer.com");
    expect(xml).not.toContain("youtube.com");
    expect(xml).not.toContain("Notice/Detail");
    for (const item of getEditorialCoverage(new Date("2026-09-05T23:00:00Z"))) {
      expect(xml).not.toContain(item.url);
    }
  });

  it("lists original reports newest first without inventing entries", () => {
    const xml = buildRssXml([
      article({
        slug: "older-report",
        path: "/articles/older-report",
        title: "Older original",
        publishedAt: "2026-01-01T00:00:00Z",
      }),
      article({
        slug: "newer-report",
        path: "/articles/newer-report",
        title: "Newer original",
        publishedAt: "2026-09-06T00:00:00Z",
      }),
    ]);
    expect(xml.indexOf("<title>Newer original</title>")).toBeLessThan(xml.indexOf("<title>Older original</title>"));
    expect(xml).not.toContain("charting-the-unknown");
    expect(xml.match(/<item>/g)).toHaveLength(2);
  });

  it("serves the feed as RSS XML and advertises it from site metadata", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
    expect(await response.text()).toBe(buildRssXml());
    expect(siteFeedAlternateTypes).toEqual({
      "application/rss+xml": [{ url: SITE_FEED_PATH, title: SITE_NAME }],
    });
    const layout = readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
    expect(layout).toContain("types: siteFeedAlternateTypes");
  });
});
