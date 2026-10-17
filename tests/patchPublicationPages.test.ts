import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { patch20300, type EditorialArticle } from "@/lib/editorialArticles";
import type { PatchEdition } from "@/lib/patchPublications";

const mocks = vi.hoisted(() => ({ catalog: vi.fn<() => Promise<{ editions: PatchEdition[]; articles: EditorialArticle[]; unavailable: boolean }>>() }));
vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: mocks.catalog }));
vi.mock("@/components/dispatch/Chrome", () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: ComponentProps<"a">) => createElement("a", { ...props, href }, children) }));

import RundownPage, { generateMetadata as rundownMetadata } from "@/app/articles/[slug]/page";
import EditionPage from "@/app/patches/[version]/page";
import sitemap from "@/app/sitemap";
import { GET as rss } from "@/app/rss.xml/route";
import { GET as atom } from "@/app/feed.xml/route";
import { patchPublications } from "@/lib/patchPublications";

const edition: PatchEdition = { version: "2.03.01", officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=132", publishedAt: "2026-09-21T14:00:00Z", observedAt: "2026-09-21T16:00:00Z", totalClaimedFixes: 1, fixes: [{ fixText: "Fixed an issue where lantern aiming would fail after changing controller inputs.", category: null, section: "Patch Details" }] };
const articleProps = { params: Promise.resolve({ slug: "patch-2-03-01" }) };

describe("rundown and archived patch routes", () => {
  beforeEach(() => mocks.catalog.mockResolvedValue({ editions: [edition], articles: patchPublications([edition]), unavailable: false }));

  it("renders the official bullet and permanent claim-record link", async () => {
    const html = renderToStaticMarkup(await RundownPage(articleProps));
    expect(html).toContain("Crimson Desert patch 2.03.01: patch notes rundown");
    expect(html).toContain(edition.fixes[0].fixText);
    expect(html).toContain('href="/patches/2-03-01"');
    expect(html).toContain('href="/patches"');
    expect(html).toContain(edition.officialUrl);
    expect(html).toContain("not establish that a player");
    const metadata = await rundownMetadata(articleProps, Promise.resolve({}) as never);
    expect(metadata.alternates?.canonical).toBe("/articles/patch-2-03-01");
  });

  it("keeps a historical version's claims separate from current player verdicts", async () => {
    const html = renderToStaticMarkup(await EditionPage({ params: Promise.resolve({ version: "2-03-01" }) }));
    expect(html).toContain(edition.fixes[0].fixText);
    expect(html).toContain("Back to the patch archive");
    expect(html).not.toContain("Read per-claim player verdicts");
    expect(html).not.toContain("Player reports this patch");
  });

  it("redirects a rundown to manual coverage of the same normalized version", async () => {
    const manual = { ...patch20300, patchVersion: "2.3.1", path: "/articles/manual-hotfix-report" as const };
    mocks.catalog.mockResolvedValue({ editions: [edition], articles: patchPublications([edition], [manual]), unavailable: false });
    await expect(RundownPage(articleProps)).rejects.toMatchObject({ digest: expect.stringContaining(manual.path) });
    const html = renderToStaticMarkup(await EditionPage({ params: Promise.resolve({ version: "2-03-01" }) }));
    expect(html).toContain(`href="${manual.path}"`);
  });

  it("uses 404 only for unknown or malformed versions, not failed database reads", async () => {
    await expect(RundownPage({ params: Promise.resolve({ slug: "patch-9-99-99" }) })).rejects.toThrow("404");
    await expect(EditionPage({ params: Promise.resolve({ version: "invalid" }) })).rejects.toThrow("404");
    mocks.catalog.mockResolvedValue({ editions: [], articles: [], unavailable: true });
    await expect(RundownPage(articleProps)).rejects.toThrow("temporarily unavailable");
    await expect(EditionPage({ params: Promise.resolve({ version: "2-03-01" }) })).rejects.toThrow("temporarily unavailable");
    expect((await rss()).status).toBe(503);
    expect((await atom()).status).toBe(503);
    await expect(sitemap()).rejects.toThrow("temporarily unavailable");
  });

  it("lists every new article and permanent patch URL in the sitemap", async () => {
    const entries = await sitemap();
    expect(entries).toContainEqual(expect.objectContaining({ url: "https://crimsonreporthub.com/articles/patch-2-03-01", lastModified: edition.publishedAt }));
    expect(entries).toContainEqual(expect.objectContaining({ url: "https://crimsonreporthub.com/patches/2-03-01" }));
    expect((await rss()).status).toBe(200);
    expect(await (await rss()).text()).toContain("/articles/patch-2-03-01");
    expect(await (await atom()).text()).toContain("/articles/patch-2-03-01");
  });
});
