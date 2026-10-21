import type { FullConfig } from "@playwright/test";

export type WarmUpRoutes = {
  /** Public pages and feeds, fetched without a session. */
  pages: string[];
  /** Operator pages, fetched with the fixture operator session. */
  operatorPages?: string[];
  /** Route handlers the browser calls. OPTIONS compiles a handler without running it. */
  apiRoutes?: string[];
};

// Next keys each optimized image by the format it picks from Accept, so match Chromium's header.
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const REQUEST_TIMEOUT_MS = 120_000;
const IMAGE_CONCURRENCY = 4;

/**
 * `next dev` compiles each route, and optimizes each image variant, on its first request. On a busy
 * runner that can outlast a 10-second assertion. So before the first test, request every route the
 * suite visits, every script and style those pages load, and every image candidate in their srcsets.
 */
export async function warmUp(config: FullConfig, routes: WarmUpRoutes) {
  const baseURLs = new Set(config.projects.map((project) => project.use.baseURL));
  for (const baseURL of baseURLs) {
    if (!baseURL) throw new Error("The warm-up requires a baseURL for every Playwright project.");
    await warmServer(baseURL, routes);
  }
}

async function warmServer(baseURL: string, { pages, operatorPages = [], apiRoutes = [] }: WarmUpRoutes) {
  const started = performance.now();
  const assets = new Set<string>();
  const images = new Set<string>();
  const timings: Array<[route: string, seconds: number]> = [];

  async function visit(route: string, init?: RequestInit) {
    const routeStarted = performance.now();
    const html = await (await send(baseURL, route, init)).text();
    timings.push([route, (performance.now() - routeStarted) / 1000]);
    // React writes srcSet and imageSrcSet in camel case.
    for (const [, attribute, value] of html.matchAll(/\s(src|href|srcset|imagesrcset)="([^"]+)"/gi)) {
      const urls = /srcset$/i.test(attribute) ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]) : [value];
      for (const url of urls.map((entry) => entry.replaceAll("&amp;", "&"))) {
        if (url.startsWith("/_next/image?")) images.add(url);
        else if (/^\/_next\/static\/[^?]+\.(?:css|js)(?:\?|$)/.test(url)) assets.add(url);
      }
    }
  }

  for (const route of pages) await visit(route);
  if (operatorPages.length > 0) {
    const cookie = await operatorCookie(baseURL);
    for (const route of operatorPages) await visit(route, { headers: { cookie } });
  }
  for (const route of apiRoutes) {
    const routeStarted = performance.now();
    await (await send(baseURL, route, { method: "OPTIONS" })).arrayBuffer();
    timings.push([route, (performance.now() - routeStarted) / 1000]);
  }
  for (const asset of assets) await (await send(baseURL, asset)).arrayBuffer();
  await inBatches([...images], IMAGE_CONCURRENCY, (image) => optimize(baseURL, image));

  const slowest = timings.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([route, seconds]) => `${route} ${seconds.toFixed(1)} s`);
  console.log(
    `Warm-up for ${baseURL} took ${((performance.now() - started) / 1000).toFixed(1)} s: ${timings.length} routes, ` +
      `${assets.size} scripts and styles, ${images.size} image variants. Slowest: ${slowest.join(", ")}.`,
  );
}

async function send(baseURL: string, route: string, init?: RequestInit) {
  try {
    return await fetch(new URL(route, baseURL), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    throw new Error(`Warm-up request failed: ${init?.method ?? "GET"} ${route}.`, { cause });
  }
}

async function operatorCookie(baseURL: string) {
  // The fixture password from tests/e2e/mock-dev-server.mjs; the fixture login keeps no state.
  const response = await send(baseURL, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "admin-password" }),
  });
  await response.arrayBuffer();
  const cookie = response.headers.getSetCookie().map((header) => header.split(";", 1)[0]).join("; ");
  if (!response.ok || !cookie) throw new Error(`Warm-up sign-in failed with HTTP ${response.status}.`);
  return cookie;
}

async function optimize(baseURL: string, image: string) {
  const response = await send(baseURL, image, { headers: { Accept: IMAGE_ACCEPT } });
  const body = await response.arrayBuffer();
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/") || body.byteLength === 0) {
    throw new Error(`Warm-up expected an optimized image for ${image}; received HTTP ${response.status}, ${response.headers.get("content-type")}, ${body.byteLength} bytes.`);
  }
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(run));
}
