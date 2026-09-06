import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getAtom } from "@/app/feed.xml/route";
import { GET as getRss } from "@/app/rss.xml/route";
import { chartingTheUnknown, editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";
import { getEditorialCoverage } from "@/lib/editorialCoverage";
import {
  ATOM_CONTENT_TYPE,
  buildAtomXml,
  buildRssXml,
  escapeXml,
  FEED_ITEM_LIMIT,
  RSS_CONTENT_TYPE,
} from "@/lib/editorialFeed";
import {
  SITE_FEED_PATH,
  SITE_FEED_SUBTITLE,
  SITE_NAME,
  SITE_RSS_PATH,
  SITE_URL,
  siteFeedAlternateTypes,
} from "@/lib/site";

function article(overrides: Partial<EditorialArticle> = {}): EditorialArticle {
  return {
    ...chartingTheUnknown,
    ...overrides,
  };
}

describe("editorial Atom/RSS of original Hub reports", () => {
  it("escapes XML special characters in text and attributes", () => {
    expect(escapeXml(`A & B <C> "D" 'E'`)).toBe("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
    const xml = buildAtomXml([
      article({
        searchTitle: `Pywel & the <islands>`,
        description: `Ships, sunken ruins & "housing"`,
        section: `Expansion & "report"`,
      }),
    ]);
    expect(xml).toContain("<title>Pywel &amp; the &lt;islands&gt;</title>");
    expect(xml).toContain("<summary>Ships, sunken ruins &amp; &quot;housing&quot;</summary>");
    expect(xml).toContain('<category term="Expansion &amp; &quot;report&quot;"/>');
    expect(xml).not.toContain("Pywel & the");
    expect(xml).not.toContain("<islands>");
  });

  it("emits Atom 1.0 for each editorial article with Hub Desk fields", () => {
    const xml = buildAtomXml();
    const link = `${SITE_URL}${chartingTheUnknown.path}`;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain(`<title>${SITE_NAME}</title>`);
    expect(xml).toContain(`<subtitle>${SITE_FEED_SUBTITLE}</subtitle>`);
    expect(xml).toContain(
      `<link rel="self" type="application/atom+xml" href="${SITE_URL}${SITE_FEED_PATH}"/>`,
    );
    expect(xml).toContain(`<link rel="alternate" type="text/html" href="${SITE_URL}/news"/>`);
    expect(xml).toContain(`<id>${SITE_URL}${SITE_FEED_PATH}</id>`);
    expect(xml).toContain(`<updated>${chartingTheUnknown.publishedAt}</updated>`);
    expect(xml.match(/<entry>/g)?.length).toBe(editorialArticles.length);
    expect(xml).toContain(`<id>${link}</id>`);
    expect(xml).toContain(`<title>${escapeXml(chartingTheUnknown.searchTitle)}</title>`);
    expect(xml).not.toContain(`<title>${chartingTheUnknown.title}</title>`);
    expect(xml).toContain(`<link rel="alternate" type="text/html" href="${link}"/>`);
    expect(xml).toContain(`<published>${chartingTheUnknown.publishedAt}</published>`);
    expect(xml).toContain(`<name>${SITE_NAME}</name>`);
    expect(xml).toContain(`<category term="${chartingTheUnknown.section}"/>`);
    expect(xml).toContain(`<summary>${escapeXml(chartingTheUnknown.description)}</summary>`);
  });

  it("mirrors the same original reports in a thin RSS 2.0 alias", () => {
    const xml = buildRssXml();
    const link = `${SITE_URL}${chartingTheUnknown.path}`;
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(`<link>${SITE_URL}/news</link>`);
    expect(xml).toContain(`<description>${SITE_FEED_SUBTITLE}</description>`);
    expect(xml).toContain(
      `<atom:link href="${SITE_URL}${SITE_RSS_PATH}" rel="self" type="application/rss+xml"/>`,
    );
    expect(xml).toContain(`<title>${escapeXml(chartingTheUnknown.searchTitle)}</title>`);
    expect(xml).toContain(`<guid isPermaLink="true">${link}</guid>`);
    expect(xml).toContain(`<description>${escapeXml(chartingTheUnknown.description)}</description>`);
    expect(xml).toContain(`<pubDate>${new Date(chartingTheUnknown.publishedAt).toUTCString()}</pubDate>`);
    expect(xml).toContain(`<category>${chartingTheUnknown.section}</category>`);
    // RSS author requires an email address; the Hub name belongs in Atom.
    expect(xml).not.toContain("<author>");
  });

  it("keeps outbound wire coverage, Watch videos, and scanner leads out of the feed", () => {
    const xml = `${buildAtomXml()}\n${buildRssXml()}`;
    expect(xml).not.toContain("pcgamer.com");
    expect(xml).not.toContain("youtube.com");
    expect(xml).not.toContain("Notice/Detail");
    expect(xml).not.toContain("/watch");
    expect(xml).not.toContain("/issues");
    expect(xml).not.toContain("/observatory");
    for (const item of getEditorialCoverage(new Date("2026-09-05T23:00:00Z"))) {
      expect(xml).not.toContain(item.url);
    }
  });

  it("lists original reports newest first, caps at 20, and does not invent entries", () => {
    const many = Array.from({ length: FEED_ITEM_LIMIT + 1 }, (_, index) =>
      article({
        slug: `report-${index}`,
        path: `/articles/report-${index}`,
        searchTitle: `Report ${index}`,
        publishedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const xml = buildAtomXml(many);
    expect(xml.match(/<entry>/g)).toHaveLength(FEED_ITEM_LIMIT);
    expect(xml).toContain("<title>Report 20</title>");
    expect(xml).not.toContain("<title>Report 0</title>");
    expect(xml.indexOf("<title>Report 20</title>")).toBeLessThan(xml.indexOf("<title>Report 19</title>"));
    expect(xml).not.toContain("charting-the-unknown");
  });

  it("serves Atom as the public feed, RSS as the alias, and advertises Atom from metadata", async () => {
    const atom = await getAtom();
    const rss = await getRss();
    expect(atom.headers.get("content-type")).toBe(ATOM_CONTENT_TYPE);
    expect(rss.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
    expect(await atom.text()).toBe(buildAtomXml());
    expect(await rss.text()).toBe(buildRssXml());
    expect(siteFeedAlternateTypes).toEqual({
      "application/atom+xml": [{ url: SITE_FEED_PATH, title: SITE_NAME }],
    });
    const layout = readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
    expect(layout).toContain("types: siteFeedAlternateTypes");
  });
});
