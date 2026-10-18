import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorialArticle } from "@/lib/editorialArticles";
import type { PublicEdition } from "@/lib/editorials/content";
import type { PatchEdition } from "@/lib/patchPublications";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn<() => Promise<{ editions: PatchEdition[]; articles: EditorialArticle[]; unavailable: boolean }>>(),
  editions: vi.fn<() => Promise<{ editions: PublicEdition[]; unavailable: boolean }>>(),
  bySlug: vi.fn<(slug: string) => Promise<PublicEdition | null>>(),
}));
vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: mocks.catalog }));
vi.mock("@/lib/editorials/store.server", () => ({ getPublicEditions: mocks.editions, getPublicEditionBySlug: mocks.bySlug }));
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
  mocks.bySlug.mockImplementation(async (slug) => (slug === edition.slug ? edition : null));
});

describe("the edition page", () => {
  it("shows the byline, the editor, the sections and the facts box last, with sources", async () => {
    const html = renderToStaticMarkup(await EditionPage(props));
    expect(html).toContain("By The Pywel Desk");
    expect(html).toContain("Edited by Statusnone");
    expect(html).toContain("Oct 26, 14:00 UTC");
    expect(html).toContain("The forecast");
    expect(html.indexOf("What&#x27;s actually true")).toBeGreaterThan(html.indexOf("The patch desk"));
    expect(html.indexOf("Sources")).toBeGreaterThan(html.indexOf("What&#x27;s actually true"));
    expect(html).toContain('href="/observatory#updates"');
    expect(html).toContain("_boardNo=140");
  });

  it("publishes NewsArticle JSON-LD by the house byline, edited by Statusnone", async () => {
    const jsonLd = editionJsonLd(edition);
    expect(jsonLd.author).toEqual({ "@type": "Organization", name: "The Pywel Desk" });
    expect(jsonLd.editor).toEqual({ "@type": "Person", name: "Statusnone" });
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
  it("merges visible editions with patch rundowns, newest first, bylined The Pywel Desk", async () => {
    const atomXml = await (await atom()).text();
    const rssXml = await (await rss()).text();
    for (const xml of [atomXml, rssXml]) {
      expect(xml).toContain(`/editorials/${edition.slug}`);
      expect(xml).toContain("/articles/patch-2-03-01");
      expect(xml.indexOf(`/editorials/${edition.slug}`)).toBeLessThan(xml.indexOf("/articles/patch-2-03-01"));
      expectNoPrivateProcessWords(xml);
    }
    expect(atomXml).toContain("<name>The Pywel Desk</name>");
    expect(rssXml).toContain("<dc:creator>The Pywel Desk</dc:creator>");
    expect(rssXml).not.toContain("<author>");
  });

  it("still serves editions when patch data fails, and patches when editions fail", async () => {
    mocks.catalog.mockResolvedValue({ editions: [], articles: patchPublications([]), unavailable: true });
    const onlyEditions = await atom();
    expect(onlyEditions.status).toBe(200);
    expect(await onlyEditions.text()).toContain(`/editorials/${edition.slug}`);

    mocks.catalog.mockResolvedValue({ editions: [patch], articles: patchPublications([patch]), unavailable: false });
    mocks.editions.mockResolvedValue({ editions: [], unavailable: true });
    const onlyPatches = await rss();
    expect(onlyPatches.status).toBe(200);
    expect(await onlyPatches.text()).toContain("/articles/patch-2-03-01");
  });

  it("returns 503 only when both reads fail", async () => {
    mocks.catalog.mockResolvedValue({ editions: [], articles: patchPublications([]), unavailable: true });
    mocks.editions.mockResolvedValue({ editions: [], unavailable: true });
    expect((await atom()).status).toBe(503);
    expect((await rss()).status).toBe(503);
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

  it("surfaces an editorial read failure in the sitemap instead of dropping editions silently", async () => {
    mocks.editions.mockResolvedValue({ editions: [], unavailable: true });
    await expect(sitemap()).rejects.toThrow("temporarily unavailable");
  });
});
