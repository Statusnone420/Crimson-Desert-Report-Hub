import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorialArticle } from "@/lib/editorialArticles";
import type { PublicEdition } from "@/lib/editorials/content";
import type { PatchEdition } from "@/lib/patchPublications";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn<() => Promise<{ editions: PatchEdition[]; articles: EditorialArticle[]; unavailable: boolean }>>(),
  editions: vi.fn<() => Promise<{ editions: PublicEdition[]; unavailable: boolean }>>(),
  sitemap: vi.fn<() => Promise<{ editions: Pick<PublicEdition, "slug" | "publishAt">[]; unavailable: boolean }>>(),
  bySlug: vi.fn<(slug: string) => Promise<PublicEdition | null>>(),
}));
vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: mocks.catalog }));
vi.mock("@/lib/editorials/store.server", () => ({ getPublicEditions: mocks.editions, getSitemapEditions: mocks.sitemap, getPublicEditionBySlug: mocks.bySlug }));
vi.mock("@/components/dispatch/Chrome", () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: ComponentProps<"a">) => createElement("a", { ...props, href }, children) }));

import EditionPage, { generateMetadata } from "@/app/editorials/[slug]/page";
import sitemap from "@/app/sitemap";
import { GET as atom } from "@/app/feed.xml/route";
import { GET as rss } from "@/app/rss.xml/route";
import { toPublicEdition } from "@/lib/editorials/content";
import { patchPublications } from "@/lib/patchPublications";
import { editionJsonLd } from "@/lib/structuredData";
import { PRIVATE_PROCESS_WORDS, publicRow } from "./editorialFixtures";

const edition = toPublicEdition(publicRow())!;
const patch: PatchEdition = { version: "2.03.01", officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=132", publishedAt: "2026-09-21T14:00:00Z", observedAt: "2026-09-21T16:00:00Z", totalClaimedFixes: 1, fixes: [{ fixText: "Fixed lantern aiming.", category: null, section: null }] };
const props = { params: Promise.resolve({ slug: edition.slug }) };

function expectNoPrivateProcessWords(text: string) {
  const lower = text.toLowerCase();
  for (const word of PRIVATE_PROCESS_WORDS) expect(lower, `public output mentions "${word}"`).not.toContain(word);
}

beforeEach(() => {
  mocks.catalog.mockResolvedValue({ editions: [patch], articles: patchPublications([patch]), unavailable: false });
  mocks.editions.mockResolvedValue({ editions: [edition], unavailable: false });
  mocks.sitemap.mockResolvedValue({ editions: [{ slug: edition.slug, publishAt: edition.publishAt }], unavailable: false });
  mocks.bySlug.mockImplementation(async (slug) => (slug === edition.slug ? edition : null));
});

describe("the edition page", () => {
  it("shows the section, the byline, the sections and the facts box last, with sources", async () => {
    const html = renderToStaticMarkup(await EditionPage(props));
    expect(html).toContain("The Pywel Desk · State of the Game");
    expect(html).toContain("By Statusnone");
    expect(html).not.toContain("Edited by");
    expect(html).toContain("Oct 26, 14:00 UTC");
    expect(html).toContain("The forecast");
    expect(html.indexOf("What&#x27;s actually true")).toBeGreaterThan(html.indexOf("The patch desk"));
    expect(html.indexOf("Sources")).toBeGreaterThan(html.indexOf("What&#x27;s actually true"));
    expect(html).toContain('href="/observatory#updates"');
    expect(html).toContain("_boardNo=140");
  });

  it("publishes NewsArticle JSON-LD by Statusnone, a plain Person with no editor", async () => {
    const jsonLd = editionJsonLd(edition);
    expect(jsonLd.author).toEqual({ "@type": "Person", name: "Statusnone" });
    expect(jsonLd).not.toHaveProperty("editor");
    expect(jsonLd.citation).toContain("https://crimsonreporthub.com/observatory#updates");
    const html = renderToStaticMarkup(await EditionPage(props));
    expect(html).toContain('"@type":"NewsArticle"');
  });

  it("returns 404 unless the edition is visible", async () => {
    await expect(EditionPage({ params: Promise.resolve({ slug: "held-edition" }) })).rejects.toThrow("404");
  });

  it("keeps model, provider and AI-process details out of the page and its metadata", async () => {
    const html = renderToStaticMarkup(await EditionPage(props));
    const metadata = await generateMetadata(props, Promise.resolve({}) as never);
    expectNoPrivateProcessWords(html);
    expectNoPrivateProcessWords(JSON.stringify(metadata));
    expect(metadata.alternates?.canonical).toBe(`/editorials/${edition.slug}`);
  });
});

describe("feeds and sitemap with editions", () => {
  it("merges visible editions with patch rundowns, newest first, signed Statusnone under The Pywel Desk", async () => {
    const atomXml = await (await atom()).text();
    const rssXml = await (await rss()).text();
    for (const xml of [atomXml, rssXml]) {
      expect(xml).toContain(`/editorials/${edition.slug}`);
      expect(xml).toContain("/articles/patch-2-03-01");
      expect(xml.indexOf(`/editorials/${edition.slug}`)).toBeLessThan(xml.indexOf("/articles/patch-2-03-01"));
      expectNoPrivateProcessWords(xml);
    }
    expect(atomXml).toContain("<name>Statusnone</name>");
    expect(atomXml).toContain('<category term="The Pywel Desk"/>');
    expect(rssXml).toContain("<dc:creator>Statusnone</dc:creator>");
    expect(rssXml).toContain("<category>The Pywel Desk</category>");
    expect(rssXml).not.toContain("<author>");
  });

  it("serves editions when patch data fails, flagged by header, a short cache and a logged code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.catalog.mockResolvedValue({ editions: [], articles: patchPublications([]), unavailable: true });
    for (const [name, get] of [["atom", atom], ["rss", rss]] as const) {
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-feed-unavailable")).toBe("patches");
      expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(await response.text()).toContain(`/editorials/${edition.slug}`);
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "feed_partial", feed: name, unavailable: "patches" }));
    }
    warn.mockRestore();
  });

  it("serves patches when editions fail: a column problem never takes down the patch feed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.editions.mockResolvedValue({ editions: [], unavailable: true });
    for (const [name, get] of [["atom", atom], ["rss", rss]] as const) {
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-feed-unavailable")).toBe("editorials");
      expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(await response.text()).toContain("/articles/patch-2-03-01");
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "feed_partial", feed: name, unavailable: "editorials" }));
    }
    warn.mockRestore();
  });

  it("returns 503 only when both reads fail", async () => {
    mocks.catalog.mockResolvedValue({ editions: [], articles: patchPublications([]), unavailable: true });
    mocks.editions.mockResolvedValue({ editions: [], unavailable: true });
    expect((await atom()).status).toBe(503);
    expect((await rss()).status).toBe(503);
  });

  it("serves a normal feed before the column's migration: no header, no log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.editions.mockResolvedValue({ editions: [], unavailable: false });
    const response = await atom();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-feed-unavailable")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
    expect(await response.text()).toContain("/articles/patch-2-03-01");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps FEED_ITEM_LIMIT across the merged list", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ ...edition, id: `e${index}`, slug: `edition-${index}`, publishAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString() }));
    mocks.editions.mockResolvedValue({ editions: many, unavailable: false });
    const xml = await (await atom()).text();
    expect(xml.match(/<entry>/g)).toHaveLength(20);
  });

  it("lists visible editions in the sitemap, without the preview feed", async () => {
    const entries = await sitemap();
    expect(entries).toContainEqual(expect.objectContaining({ url: `https://crimsonreporthub.com/editorials/${edition.slug}`, lastModified: edition.publishAt }));
    expect(entries.some((entry) => entry.url.includes("preview"))).toBe(false);
    expectNoPrivateProcessWords(JSON.stringify(entries));
  });

  it("lists every edition the sitemap read returns, past the feeds' limit", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ slug: `edition-${index}`, publishAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString() }));
    mocks.sitemap.mockResolvedValue({ editions: many, unavailable: false });
    const entries = await sitemap();
    expect(entries.filter((entry) => entry.url.includes("/editorials/"))).toHaveLength(60);
  });

  it("keeps the sitemap working when editions fail, and logs the gap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.sitemap.mockResolvedValue({ editions: [], unavailable: true });
    const entries = await sitemap();
    expect(entries).toContainEqual(expect.objectContaining({ url: "https://crimsonreporthub.com/articles/patch-2-03-01" }));
    expect(entries.some((entry) => entry.url.includes("/editorials/"))).toBe(false);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "feed_partial", feed: "sitemap", unavailable: "editorials" }));
    warn.mockRestore();
  });
});
