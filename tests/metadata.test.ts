import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL } from "@/lib/site";
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

  it("gives each public route a distinct title and its own canonical", async () => {
    const [issues, report, about, scanner] = await Promise.all([
      import("@/app/issues/page"),
      import("@/app/report/page"),
      import("@/app/about/page"),
      import("@/app/scanner/page"),
    ]);
    expect(issues.metadata).toMatchObject({ title: "Issue Board", alternates: { canonical: "/issues" } });
    expect(report.metadata).toMatchObject({ title: "File a Report", alternates: { canonical: "/report" } });
    expect(about.metadata).toMatchObject({ title: "Method", alternates: { canonical: "/about" } });
    expect(scanner.metadata).toMatchObject({ title: "The Observatory", alternates: { canonical: "/scanner" } });
  });
});
