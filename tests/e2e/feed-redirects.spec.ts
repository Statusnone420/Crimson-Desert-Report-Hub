import { expect, test } from "@playwright/test";

const legacyFeedPaths = [
  { source: "/feeds", destination: "/feed.xml", contentType: "application/atom+xml", root: "<feed " },
  { source: "/feeds/sitemap", destination: "/sitemap.xml", contentType: "application/xml", root: "<urlset " },
] as const;

for (const { source, destination, contentType, root } of legacyFeedPaths) {
  test(`${source} permanently redirects to its canonical XML endpoint`, async ({ request }) => {
    for (const method of ["GET", "HEAD"]) {
      const redirect = await request.fetch(source, { method, maxRedirects: 0 });
      expect(redirect.status()).toBe(308);
      expect(redirect.headers().location).toBe(destination);
    }

    const canonical = await request.get(source);
    expect(canonical.status()).toBe(200);
    expect(new URL(canonical.url()).pathname).toBe(destination);
    expect(canonical.headers()["content-type"]).toContain(contentType);
    expect(await canonical.text()).toContain(root);

    const withQuery = await request.get(`${source}?source=legacy`, { maxRedirects: 0 });
    expect(withQuery.status()).toBe(308);
    expect(withQuery.headers().location).toBe(`${destination}?source=legacy`);
  });
}
