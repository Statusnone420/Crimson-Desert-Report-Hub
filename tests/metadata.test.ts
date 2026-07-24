import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { routeOpenGraph, SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL } from "@/lib/site";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";

vi.mock("server-only", () => ({}));

const appDir = path.join(process.cwd(), "src", "app");

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("search and share metadata", () => {
  it("keeps the search strings inside their display budgets, unofficial disclosed", () => {
    expect(SITE_SEARCH_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_SEARCH_TITLE.startsWith(SITE_NAME)).toBe(true);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("unofficial");
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
  });

  it("describes the card identically for both share alt files", () => {
    const ogAlt = readFileSync(path.join(appDir, "opengraph-image.alt.txt"), "utf8").trim();
    const twitterAlt = readFileSync(path.join(appDir, "twitter-image.alt.txt"), "utf8").trim();
    expect(ogAlt).toBe(twitterAlt);
    expect(ogAlt).toContain(SITE_NAME);
    expect(ogAlt).toContain("What changed. What players are reporting. What matters now.");
    expect(ogAlt.toLowerCase()).toContain("unofficial");
  });

  it("lists every public route in the sitemap without claiming modification dates", () => {
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      SITE_URL,
      `${SITE_URL}/issues`,
      `${SITE_URL}/scanner`,
      `${SITE_URL}/report`,
      `${SITE_URL}/about`,
    ]);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("lastModified");
    }
    expect(entries[0]).toMatchObject({ changeFrequency: "hourly", priority: 1 });
  });

  it("emits homepage WebSite JSON-LD with the proper site name, script-safe", () => {
    const data = webSiteJsonLd();
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
    });
    expect(serializeJsonLd({ evil: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(serializeJsonLd(data)).toContain('"@type":"WebSite"');
  });

  it("gives each route a distinct title, matching canonical and og:url, and keeps the parent's share images", async () => {
    const [issues, report, about, scanner] = await Promise.all([
      import("@/app/issues/page"),
      import("@/app/report/page"),
      import("@/app/about/page"),
      import("@/app/scanner/page"),
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
    }) as never;

    const expectations = [
      [issues, "Issue Board", "/issues"],
      [report, "File a Report", "/report"],
      [about, "Method", "/about"],
      [scanner, "The Observatory", "/scanner"],
    ] as const;
    for (const [page, title, path] of expectations) {
      const meta = await page.generateMetadata({}, parent);
      expect(meta).toMatchObject({ title, alternates: { canonical: path } });
      const og = meta.openGraph as Record<string, unknown>;
      expect(og.url).toBe(path);
      expect(og).toMatchObject({ siteName: SITE_NAME, title: SITE_NAME, description: SITE_OG_DESCRIPTION });
      expect(og.images).toEqual([{ url: `${SITE_URL}/opengraph-image.png?hash`, width: 1200, height: 630 }]);
    }
    // The root block stays image-free so the file convention attaches there.
    expect(routeOpenGraph("/")).not.toHaveProperty("images");
    expect(routeOpenGraph("/").url).toBe("/");
  });
});
