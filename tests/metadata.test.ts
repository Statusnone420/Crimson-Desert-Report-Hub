import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { routeOpenGraph, SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL } from "@/lib/site";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";
import nextConfig from "../next.config";

vi.mock("server-only", () => ({}));

const appDir = path.join(process.cwd(), "src", "app");
const expectedDescriptions = {
  "/":
    "Crimson Desert Report Hub is the unofficial brief on each patch — charting what players report, what sources pick up, and which claimed fixes haven't settled.",
  "/issues":
    "The Issue Board lays out Crimson Desert player reports and source leads, showing how much backing reports have and where the claimed fixes stand.",
  "/report":
    "Hit something broken in Crimson Desert? Put it on the record — an anonymous report with the patch, platform, steps, and any evidence you've got.",
  "/about":
    "How the Report Hub thinks: what separates player reports, source leads, and official fix claims — and why quiet never counts as fixed.",
  "/scanner":
    "The Observatory scans the public web for Crimson Desert trouble: fresh leads, repeat sightings, and the questions they raise.",
} as const;

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("search and share metadata", () => {
  it("pins the homepage search and share copy inside their display budgets", () => {
    expect(SITE_SEARCH_TITLE).toBe(`${SITE_NAME} — Patch Issues & Player Reports`);
    expect(SITE_SEARCH_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_SEARCH_TITLE.startsWith(SITE_NAME)).toBe(true);
    expect(SITE_DESCRIPTION).toBe(expectedDescriptions["/"]);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("unofficial");
    expect(SITE_OG_DESCRIPTION).toBe(
      "What changed. What players are reporting. What matters now. An unofficial, fan-run field report on the current state of the game.",
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
    expect(entries).toEqual([
      { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
      { url: `${SITE_URL}/issues`, changeFrequency: "hourly", priority: 0.9 },
      { url: `${SITE_URL}/scanner`, changeFrequency: "hourly", priority: 0.5 },
      { url: `${SITE_URL}/report`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
    ]);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("lastModified");
    }
  });

  it("keeps the three repository-owned alternate addresses as permanent redirects", async () => {
    expect(await nextConfig.redirects?.()).toEqual([
      {
        source: "/method",
        destination: "/about",
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
      [issues, "Issue Board", "/issues", expectedDescriptions["/issues"]],
      [report, "File a Report", "/report", expectedDescriptions["/report"]],
      [about, "Method", "/about", expectedDescriptions["/about"]],
      [scanner, "The Observatory", "/scanner", expectedDescriptions["/scanner"]],
    ] as const;
    const descriptions: string[] = [SITE_DESCRIPTION];
    for (const [page, title, path, description] of expectations) {
      const meta = await page.generateMetadata({}, parent);
      expect(meta).toMatchObject({ title, description, alternates: { canonical: path } });
      descriptions.push(meta.description as string);
      const og = meta.openGraph as Record<string, unknown>;
      expect(og.url).toBe(path);
      expect(og).toMatchObject({ siteName: SITE_NAME, title: SITE_NAME, description: SITE_OG_DESCRIPTION });
      expect(og.images).toEqual([{ url: `${SITE_URL}/opengraph-image.png?hash`, width: 1200, height: 630 }]);
    }
    expect(descriptions).toEqual(Object.values(expectedDescriptions));
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
  });
});
