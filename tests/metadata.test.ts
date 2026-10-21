
vi.mock("@/lib/patchPublications.server", async () => {
  const { editorialArticles } = await import("@/lib/editorialArticles");
  return { getPatchPublications: vi.fn(async () => ({ articles: [...editorialArticles], editions: [], unavailable: false })) };
});
// Column editions are covered in editorialPublicSurfaces.test.ts; none exist here.
vi.mock("@/lib/editorials/store.server", () => ({
  getPublicEditions: vi.fn(async () => ({ editions: [], unavailable: false })),
  getSitemapEditions: vi.fn(async () => ({ editions: [], unavailable: false })),
}));
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { chartingTheUnknown, chartingTheUnknownDelay, editorialArticles, patch20200, patch20300 } from "@/lib/editorialArticles";
import { routeOpenGraph, SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";
import nextConfig from "../next.config";

vi.mock("server-only", () => ({}));

const appDir = path.join(process.cwd(), "src", "app");
const expectedDescriptions = {
  "/":
    "Crimson Desert Report Hub is an unofficial newspaper for Crimson Desert news, expansion reports, official updates, and player records.",
  "/news":
    "Source-backed Crimson Desert news and expansion reports from the Crimson Desert Report Hub.",
  "/patches":
    "Follow the latest Crimson Desert patch notes, official fix claims, and player reports. See what changed and what still needs checking.",
  "/watch":
    "The Crimson Desert reveal trailer and selected creator coverage of Charting the Unknown, with links to the original videos.",
  "/issues":
    "Known Crimson Desert issues on the current patch, from public player posts and the official fix notes.",
  "/about":
    "How Crimson Desert Report Hub sources its journalism, credits creators, and keeps news separate from player reports and official fix claims.",
  "/contact":
    "Report a website problem, request a correction or content removal, and find the right place for game support at Crimson Desert Report Hub.",
  "/privacy":
    "Anonymous issue check-ins use Turnstile and one current response per network, issue, and exact patch. No raw IP address is stored.",
  "/observatory":
    "Recorded Steam review movement, Twitch audience activity, and the current public-source radar for Crimson Desert.",
  "/topics/charting-the-unknown":
    "When Crimson Desert’s Charting the Unknown expansion lands, what unlocks when, and the official videos, from Pearl Abyss’s own notices.",
} as const;

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("search and share metadata", () => {
  it("pins the homepage search and share copy inside their display budgets", () => {
    expect(SITE_SEARCH_TITLE).toBe(`${SITE_NAME} — News & Expansion Reports`);
    expect(SITE_SEARCH_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_SEARCH_TITLE.startsWith(SITE_NAME)).toBe(true);
    expect(SITE_DESCRIPTION).toBe(expectedDescriptions["/"]);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("unofficial");
    expect(SITE_OG_DESCRIPTION).toBe(
      "Crimson Desert news, Charting the Unknown coverage, creator videos, and official updates from an unofficial fan newspaper.",
    );
    expect(SITE_OG_DESCRIPTION.length).toBeLessThanOrEqual(200);
    expect(SITE_OG_DESCRIPTION.toLowerCase()).toContain("unofficial");
  });

  it("ships one share card: og and twitter images are the approved 1200x630 render", () => {
    const og = readFileSync(path.join(appDir, "opengraph-image.png"));
    const twitter = readFileSync(path.join(appDir, "twitter-image.png"));
    const approved = readFileSync(path.join(process.cwd(), "docs", "share-card", "preview-1200x630.png"));
    expect(og.equals(twitter)).toBe(true);
    expect(og.equals(approved)).toBe(true);
    expect(pngSize(path.join(appDir, "opengraph-image.png"))).toEqual({ width: 1200, height: 630 });
    expect(twitter.length).toBeLessThan(5_000_000);
  });

  it("describes the card identically for both share alt files", () => {
    const ogAlt = readFileSync(path.join(appDir, "opengraph-image.alt.txt"), "utf8").trim();
    const twitterAlt = readFileSync(path.join(appDir, "twitter-image.alt.txt"), "utf8").trim();
    expect(ogAlt).toBe(twitterAlt);
    expect(ogAlt).toContain(SITE_NAME);
    expect(ogAlt).toContain("The stories behind the updates.");
    expect(ogAlt.toLowerCase()).toContain("unofficial");
  });

  it("lists editorial routes ahead of supporting records and dates only original reports", async () => {
    const entries = await sitemap();
    expect(entries).toEqual([
      { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
      { url: `${SITE_URL}/news`, changeFrequency: "weekly", priority: 0.9 },
      { url: `${SITE_URL}/catch-up`, changeFrequency: "weekly", priority: 0.8 },
      { url: `${SITE_URL}/topics/charting-the-unknown`, changeFrequency: "daily", priority: 0.8 },
      { url: `${SITE_URL}${chartingTheUnknownDelay.path}`, lastModified: chartingTheUnknownDelay.publishedAt, changeFrequency: "monthly", priority: 0.8 },
      {
        url: `${SITE_URL}/articles/patch-2-03-00`,
        lastModified: patch20300.publishedAt,
        changeFrequency: "monthly",
        priority: 0.8,
      },
      {
        url: `${SITE_URL}/articles/patch-2-02-00`,
        lastModified: patch20200.publishedAt,
        changeFrequency: "monthly",
        priority: 0.8,
      },
      {
        url: `${SITE_URL}/articles/charting-the-unknown`,
        lastModified: "2026-10-06T01:05:00Z",
        changeFrequency: "monthly",
        priority: 0.8,
      },
      { url: `${SITE_URL}/watch`, changeFrequency: "weekly", priority: 0.7 },
      { url: `${SITE_URL}/patches`, changeFrequency: "hourly", priority: 0.6 },
      { url: `${SITE_URL}/issues`, changeFrequency: "hourly", priority: 0.5 },
      { url: `${SITE_URL}/observatory`, changeFrequency: "hourly", priority: 0.5 },
      { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.3 },
      { url: `${SITE_URL}/contact`, changeFrequency: "monthly", priority: 0.3 },
      { url: `${SITE_URL}/feed.xml`, changeFrequency: "weekly", priority: 0.2 },
      { url: `${SITE_URL}/rss.xml`, changeFrequency: "weekly", priority: 0.2 },
      { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    ]);
    for (const entry of entries.filter((entry) => !editorialArticles.some((article) => entry.url === `${SITE_URL}${article.path}`))) {
      expect(entry).not.toHaveProperty("lastModified");
    }
    expect(entries).not.toContainEqual(expect.objectContaining({ url: `${SITE_URL}/report` }));
  });

  it("redirects alternate addresses without retiring the contact page", async () => {
    const resolvedConfig = await nextConfig("phase-production-server");
    expect(await resolvedConfig.redirects?.()).toEqual([
      {
        source: "/method",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/scanner",
        destination: "/observatory",
        permanent: true,
      },
      {
        source: "/feeds",
        destination: "/feed.xml",
        permanent: true,
      },
      {
        source: "/feeds/sitemap",
        destination: "/sitemap.xml",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "crimson-desert-report-hub\\.vercel\\.app",
          },
        ],
        destination: "https://crimsonreporthub.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www\\.crimsonreporthub\\.com",
          },
        ],
        destination: "https://crimsonreporthub.com/:path*",
        permanent: true,
      },
    ]);
  });

  it("emits homepage WebSite JSON-LD with the proper site name, script-safe", () => {
    const data = webSiteJsonLd();
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: expectedDescriptions["/"],
    });
    expect(serializeJsonLd({ evil: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(serializeJsonLd(data)).toContain('"@type":"WebSite"');
  });

  it("gives each route a distinct title, matching canonical and og:url, and keeps the parent's share images", async () => {
    const [issues, about, contact, privacy, observatory, news, watch, patches, expansionDesk] = await Promise.all([
      import("@/app/issues/page"),
      import("@/app/about/page"),
      import("@/app/contact/page"),
      import("@/app/privacy/page"),
      import("@/app/observatory/page"),
      import("@/app/news/page"),
      import("@/app/watch/page"),
      import("@/app/patches/page"),
      import("@/app/topics/charting-the-unknown/page"),
    ]);
    // The resolved root openGraph as Next hands it to generateMetadata: it
    // already carries the file-convention share image. A route override must
    // keep that image while pointing og:url at itself.
    const parent = Promise.resolve({
      openGraph: {
        type: "website",
        url: `${SITE_URL}`,
        siteName: SITE_NAME,
        title: SITE_NAME,
        description: SITE_OG_DESCRIPTION,
        images: [{ url: `${SITE_URL}/opengraph-image.png?hash`, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: SITE_NAME,
        description: SITE_OG_DESCRIPTION,
        images: [{ url: `${SITE_URL}/twitter-image.png?hash`, width: 1200, height: 630 }],
      },
    }) as never;

    const expectations = [
      [issues, "Issue Board", "/issues", expectedDescriptions["/issues"]],
      [about, "Method", "/about", expectedDescriptions["/about"]],
      [contact, "Contact the Hub", "/contact", expectedDescriptions["/contact"]],
      [privacy, "Privacy", "/privacy", expectedDescriptions["/privacy"]],
      [observatory, "The Observatory", "/observatory", expectedDescriptions["/observatory"]],
      [news, "Crimson Desert news", "/news", expectedDescriptions["/news"]],
      [watch, "Crimson Desert videos", "/watch", expectedDescriptions["/watch"]],
      [patches, "Crimson Desert patch notes: what changed", "/patches", expectedDescriptions["/patches"]],
      [expansionDesk, "Charting the Unknown: release time and what unlocks when", "/topics/charting-the-unknown", expectedDescriptions["/topics/charting-the-unknown"]],
    ] as const;
    const descriptions: string[] = [SITE_DESCRIPTION];
    for (const [page, title, path, description] of expectations) {
      const meta = await page.generateMetadata({}, parent);
      expect(meta).toMatchObject({
        title,
        description,
        alternates: { canonical: path, types: siteFeedAlternateTypes },
      });
      descriptions.push(meta.description as string);
      const og = meta.openGraph as Record<string, unknown>;
      expect(og.url).toBe(path);
      expect(og).toMatchObject({ siteName: SITE_NAME, title, description });
      expect(og.images).toEqual([{ url: `${SITE_URL}/opengraph-image.png?hash`, width: 1200, height: 630 }]);
      const twitter = meta.twitter as Record<string, unknown>;
      expect(twitter).toMatchObject({ card: "summary_large_image", title, description });
      expect(twitter.images).toEqual([{ url: `${SITE_URL}/twitter-image.png?hash`, width: 1200, height: 630 }]);
    }
    expect([...descriptions].sort()).toEqual(Object.values(expectedDescriptions).sort());
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const description of descriptions) {
      expect(description.length).toBeLessThanOrEqual(160);
    }
    expect(descriptions.filter((description) => description.toLowerCase().includes("unofficial"))).toEqual([
      SITE_DESCRIPTION,
    ]);
    // The root block stays image-free so the file convention attaches there.
    expect(routeOpenGraph("/")).toEqual({
      type: "website",
      url: "/",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_OG_DESCRIPTION,
    });
    const { metadata: operatorMetadata } = await import("@/app/operator/page");
    expect(operatorMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("gives the delay story its own dates, canonical URL and official announcement artwork", async () => {
    const { metadata } = await import("@/app/articles/charting-the-unknown-delay/page");
    const report = chartingTheUnknownDelay;
    const image = { url: `${SITE_URL}${report.shareImage.src}`, width: 1920, height: 1080, alt: report.shareImage.alt };
    expect(metadata).toMatchObject({
      title: report.searchTitle, description: report.description,
      alternates: { canonical: report.path, types: siteFeedAlternateTypes },
      openGraph: { type: "article", url: report.path, publishedTime: report.publishedAt, images: [image] },
      twitter: { card: "summary_large_image", images: [image] },
    });
    expect(report.searchTitle.length).toBeLessThanOrEqual(70);
    expect(report.description.length).toBeLessThanOrEqual(160);
    expect(newsArticleJsonLd(report)).toMatchObject({ headline: report.title, datePublished: report.publishedAt, citation: report.sources.map((source) => source.url) });
    const original = readFileSync(path.join(process.cwd(), "public", report.shareImage.src));
    expect(original.subarray(8, 12).toString()).toBe("WEBP");
    expect(original.length).toBeLessThan(5_000_000);
  });

  it.each([patch20200, patch20300])("gives $slug absolute article images and sourced NewsArticle data", async (report) => {
    const { metadata } = report === patch20300
      ? await import("@/app/articles/patch-2-03-00/page")
      : await import("@/app/articles/patch-2-02-00/page");
    const image = {
      url: `${SITE_URL}${report.shareImage.src}`,
      width: 1200,
      height: 630,
      alt: report.shareImage.alt,
    };
    expect(metadata).toMatchObject({
      title: report.searchTitle,
      description: report.description,
      alternates: { canonical: report.path, types: siteFeedAlternateTypes },
      openGraph: { type: "article", url: report.path, publishedTime: report.publishedAt, images: [image] },
      twitter: { card: "summary_large_image", title: report.searchTitle, description: report.description, images: [image] },
    });
    expect(report.searchTitle.length).toBeLessThanOrEqual(70);
    expect(report.description.length).toBeLessThanOrEqual(160);
    const file = path.join(process.cwd(), "public", report.shareImage.src);
    expect(pngSize(file)).toEqual({ width: image.width, height: image.height });
    expect(readFileSync(file).length).toBeLessThan(5_000_000);
    expect(readFileSync(file).equals(readFileSync(path.join(process.cwd(), `docs/share-card/preview-${report.slug}.png`)))).toBe(true);
    const data = newsArticleJsonLd(report);
    expect(data).toMatchObject({
      "@type": "NewsArticle",
      headline: report.title,
      datePublished: report.publishedAt,
      mainEntityOfPage: `${SITE_URL}${report.path}`,
      citation: report.sources.map((source) => source.url),
    });
    expect(data).not.toHaveProperty("author");
    expect(data).not.toHaveProperty("dateModified");
  });

  it("gives the original expansion report its own canonical metadata and sourced NewsArticle data", async () => {
    const article = await import("@/app/articles/charting-the-unknown/page");
    expect(article.metadata).toMatchObject({
      title: chartingTheUnknown.searchTitle,
      description: chartingTheUnknown.description,
      alternates: { canonical: chartingTheUnknown.path, types: siteFeedAlternateTypes },
      openGraph: {
        type: "article",
        url: chartingTheUnknown.path,
        publishedTime: chartingTheUnknown.publishedAt,
        modifiedTime: "2026-10-06T01:05:00Z",
        images: [{
          url: chartingTheUnknown.heroImage.src,
          width: chartingTheUnknown.heroImage.width,
          height: chartingTheUnknown.heroImage.height,
          alt: chartingTheUnknown.heroImage.alt,
        }],
      },
      twitter: {
        card: "summary_large_image",
        title: chartingTheUnknown.searchTitle,
        description: chartingTheUnknown.description,
        images: [chartingTheUnknown.heroImage.src],
      },
    });
    const data = newsArticleJsonLd(chartingTheUnknown);
    expect(data).toMatchObject({
      "@type": "NewsArticle",
      headline: chartingTheUnknown.title,
      datePublished: "2026-09-05T00:00:00Z",
      dateModified: "2026-10-06T01:05:00Z",
      mainEntityOfPage: `${SITE_URL}${chartingTheUnknown.path}`,
      citation: chartingTheUnknown.sources.map((source) => source.url),
    });
    expect(data).not.toHaveProperty("author");
  });
});
