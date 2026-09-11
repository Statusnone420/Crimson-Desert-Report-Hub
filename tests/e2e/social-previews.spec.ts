import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { patch20200 } from "../../src/lib/editorialArticles";
import { SITE_URL } from "../../src/lib/site";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

function metaContent(head: string, property: string): string {
  const tags = [...head.matchAll(/<meta\s[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(`name="${property}"`) || tag.includes(`property="${property}"`));
  expect(tags, `${property} must occur once in the server-rendered head`).toHaveLength(1);
  const content = tags[0].match(/content="([^"]+)"/)?.[1];
  expect(content, `${property} must not be empty`).toBeTruthy();
  // Decode ampersands last so nested entities remain literal after one layer.
  return content!.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

test("metadata extraction decodes exactly one HTML entity layer", () => {
  const cases = [
    ["Plain title", "Plain title"],
    ["A &amp; B &quot;C&quot; &#x27;D&#x27;", `A & B "C" 'D'`],
    ["&amp;quot; &amp;#x27; &amp;amp;", "&quot; &#x27; &amp;"],
    ["&amp;amp;quot; &amp;lt;script&amp;gt;", "&amp;quot; &lt;script&gt;"],
    ["https://example.com/card?q=&amp;quot;&amp;size=large", "https://example.com/card?q=&quot;&size=large"],
  ];
  for (const [encoded, decoded] of cases) {
    const head = `<meta name="twitter:title" content="${encoded}"/>`;
    expect(metaContent(head, "twitter:title")).toBe(decoded);
  }
});

test("X and messaging crawlers receive complete cards and publicly readable image bytes", async ({ request, baseURL }) => {
  for (const userAgent of ["Twitterbot/1.0", "facebookexternalhit/1.1"]) {
    for (const route of ["/", "/news", "/patches", patch20200.path]) {
      const response = await request.get(route, { headers: { "User-Agent": userAgent } });
      expect(response.status()).toBe(200);
      const html = await response.text();
      const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
      expect(head, `${userAgent} must receive metadata without running JavaScript`).toBeTruthy();
      expect(metaContent(head!, "twitter:card")).toBe("summary_large_image");
      for (const prefix of ["twitter", "og"]) {
        expect(metaContent(head!, `${prefix}:title`)).toContain("Crimson Desert");
        expect(metaContent(head!, `${prefix}:description`).length).toBeGreaterThan(40);
        expect(metaContent(head!, `${prefix}:image:alt`).length).toBeGreaterThan(20);
        const imageUrl = new URL(metaContent(head!, `${prefix}:image`));
        if (route === patch20200.path) {
          expect(imageUrl.origin).toBe(SITE_URL);
          expect(imageUrl.pathname).toBe(patch20200.shareImage.src);
          expect(metaContent(head!, `${prefix}:title`)).toBe(patch20200.searchTitle);
        } else {
          // Next's file convention deliberately uses localhost in development.
          // The production build is checked separately against SITE_URL.
          expect(imageUrl.origin).toBe(new URL(baseURL!).origin.replace("127.0.0.1", "localhost"));
          expect(imageUrl.pathname).toBe(prefix === "twitter" ? "/twitter-image.png" : "/opengraph-image.png");
        }
        // Production canonical URLs are intentional. Fetch the same path from
        // the local build so a draft never needs an unpublished production file.
        const image = await request.get(`${imageUrl.pathname}${imageUrl.search}`, { headers: { "User-Agent": userAgent } });
        expect(image.status()).toBe(200);
        expect(image.headers()["content-type"]).toContain("image/png");
        const imageHead = await request.head(`${imageUrl.pathname}${imageUrl.search}`, { headers: { "User-Agent": userAgent } });
        expect(imageHead.status()).toBe(200);
        expect(imageHead.headers()["content-type"]).toContain("image/png");
        const bytes = await image.body();
        expect(bytes.length).toBeGreaterThan(10_000);
        expect(bytes.length).toBeLessThan(5_000_000);
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(bytes.readUInt32BE(16)).toBe(Number(metaContent(head!, `${prefix}:image:width`)));
        expect(bytes.readUInt32BE(20)).toBe(Number(metaContent(head!, `${prefix}:image:height`)));
        if (route !== patch20200.path) {
          expect(bytes.equals(readFileSync("docs/share-card/preview-1200x630.png"))).toBe(true);
        }
      }
      expect(metaContent(head!, "og:url")).toBe(`${SITE_URL}${route === "/" ? "" : route}`);
    }
  }
});

test("the new report is readable from News and is present in RSS and Atom", async ({ page, request }, testInfo) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/news");
  await page.getByRole("link", { name: patch20200.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${patch20200.path}$`));
  await expect(page.getByRole("heading", { name: patch20200.title, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "News", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".article-hero img")).toBeVisible();
  await expect(page.locator("#article-body")).toContainText("At publication, the update was available");
  await expect(page.locator("#article-body")).toContainText("Mac App Store update was still in progress");
  await expect(page.getByRole("heading", { name: "What is still unconfirmed?", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE_URL}${patch20200.path}`);
  const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
  expect(schema).toMatchObject({ "@type": "NewsArticle", headline: patch20200.title, datePublished: patch20200.publishedAt });
  for (const source of patch20200.sources) {
    await expect(page.locator("#sources").getByRole("link", { name: `${source.label} ↗`, exact: true })).toHaveAttribute("href", source.url);
  }
  await expectHealthyPage(page, problems);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync("output/playwright", { recursive: true });
  await page.screenshot({ animations: "disabled", path: `output/playwright/patch-2-02-00-${testInfo.project.name}.png`, fullPage: true });
  for (const route of ["/rss.xml", "/feed.xml"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`${SITE_URL}${patch20200.path}`);
  }
});
