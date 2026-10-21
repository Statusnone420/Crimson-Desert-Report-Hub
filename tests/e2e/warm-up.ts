import type { FullConfig } from "@playwright/test";

export type WarmUpRoutes = {
  /** Public pages and feeds, fetched without a session. */
  pages: string[];
  /** Pages a spec expects to be missing. They must answer 404. */
  missingPages?: string[];
  /** Operator pages, fetched with the fixture operator session. */
  operatorPages?: string[];
  /** Route handlers the browser calls. OPTIONS compiles a handler without running it. */
  apiRoutes?: string[];
};

// Next keys each optimized image by the format it picks from Accept, so match Chromium's header.
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const REQUEST_TIMEOUT_MS = 120_000;
const CONCURRENCY = 4;

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

async function warmServer(baseURL: string, { pages, missingPages = [], operatorPages = [], apiRoutes = [] }: WarmUpRoutes) {
  const started = performance.now();
  const assets = new Set<string>();
  const images = new Set<string>();
  const timings: Array<[route: string, seconds: number]> = [];

  async function visit(route: string, init?: RequestInit, expectedStatus?: number) {
    const routeStarted = performance.now();
    const html = await load(baseURL, route, init, expectedStatus);
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

  // Route handlers go first. On a dev server that has already compiled the pages, compiling the
  // handlers took the main suite's server from about 6 GB to 19 GB, more than a CI runner has.
  const cookie = operatorPages.length > 0 ? await operatorCookie(baseURL) : undefined;
  await inParallel(apiRoutes, async (route) => {
    const routeStarted = performance.now();
    await load(baseURL, route, { method: "OPTIONS" });
    timings.push([route, (performance.now() - routeStarted) / 1000]);
  });
  await inParallel(pages, (route) => visit(route));
  await inParallel(missingPages, (route) => visit(route, undefined, 404));
  await inParallel(operatorPages, (route) => visit(route, { headers: { cookie: cookie! } }));
  await inParallel(assets, async (asset) => {
    await load(baseURL, asset);
  });
  await inParallel(images, (image) => optimize(baseURL, image));

  const slowest = timings.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([route, seconds]) => `${route} ${seconds.toFixed(1)} s`);
  console.log(
    `Warm-up for ${baseURL} took ${((performance.now() - started) / 1000).toFixed(1)} s: ${timings.length} routes, ` +
      `${assets.size} scripts and styles, ${images.size} image variants. Slowest: ${slowest.join(", ")}.`,
  );
}

/** Returns the body, or fails unless the route answers 2xx (after redirects) or the expected status. */
async function load(baseURL: string, route: string, init?: RequestInit, expectedStatus?: number) {
  const response = await send(baseURL, route, init);
  const body = await response.text();
  if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
    throw new Error(`Warm-up expected ${init?.method ?? "GET"} ${route} to answer ${expectedStatus ?? "2xx"}; received HTTP ${response.status}.`);
  }
  return body;
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

/** Runs `run` for every item, `CONCURRENCY` at a time. */
async function inParallel(items: Iterable<string>, run: (item: string) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
  }));
}
