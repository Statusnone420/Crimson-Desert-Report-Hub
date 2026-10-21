import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { FullConfig } from "@playwright/test";
import { afterEach, expect, test, vi } from "vitest";
import { warmUp } from "./e2e/warm-up";

const CHROMIUM_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

// React writes srcSet and imageSrcSet in camel case and escapes & in attributes, as Next's pages do.
const FRONT_PAGE = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/_next/static/chunks/page.css"/>
<link rel="preload" href="/_next/static/media/font.woff2" as="font"/>
<link rel="preload" as="image" imageSrcSet="/_next/image?url=%2Flead.jpg&amp;w=384&amp;q=75 384w, /_next/image?url=%2Flead.jpg&amp;w=640&amp;q=75 640w"/>
<script src="/_next/static/chunks/page.js" async=""></script></head>
<body><img srcSet="/_next/image?url=%2Fcard.png&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fcard.png&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fcard.png&amp;w=3840&amp;q=75"/>
<img src="/icons/moon.svg"/></body></html>`;

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  vi.restoreAllMocks();
});

async function serve(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const requests: Array<{ method: string; url: string; accept?: string; cookie?: string }> = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "", accept: req.headers.accept, cookie: req.headers.cookie });
    handle(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

function config(...baseURLs: string[]) {
  return { projects: baseURLs.map((baseURL) => ({ use: { baseURL } })) } as unknown as FullConfig;
}

function fixtureSite(req: IncomingMessage, res: ServerResponse) {
  if (req.url?.startsWith("/_next/image?")) {
    res.writeHead(200, { "content-type": "image/webp" }).end("webp");
  } else if (req.method === "POST" && req.url === "/api/admin/login") {
    res.writeHead(200, { "set-cookie": "cd_admin=fixture-session; Path=/; HttpOnly" }).end("{}");
  } else if (req.method === "OPTIONS") {
    res.writeHead(204).end();
  } else if (req.url === "/operator") {
    res.writeHead(req.headers.cookie === "cd_admin=fixture-session" ? 200 : 307, { "content-type": "text/html" })
      .end('<img src="/_next/image?url=%2Fdesk.jpg&amp;w=640&amp;q=75"/>');
  } else {
    res.writeHead(200, { "content-type": "text/html" }).end(req.url === "/" ? FRONT_PAGE : "");
  }
}

test("the warm-up opens every route and loads every script, style and image candidate those pages name", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { baseURL, requests } = await serve(fixtureSite);

  await warmUp(config(baseURL), { pages: ["/"], operatorPages: ["/operator"], apiRoutes: ["/api/confirmations"] });

  expect(requests.map(({ method, url }) => `${method} ${url}`).sort()).toEqual([
    "GET /",
    "GET /_next/image?url=%2Fcard.png&w=32&q=75",
    "GET /_next/image?url=%2Fcard.png&w=3840&q=75",
    "GET /_next/image?url=%2Fdesk.jpg&w=640&q=75",
    "GET /_next/image?url=%2Flead.jpg&w=384&q=75",
    "GET /_next/image?url=%2Flead.jpg&w=640&q=75",
    "GET /_next/static/chunks/page.css",
    "GET /_next/static/chunks/page.js",
    "GET /operator",
    "OPTIONS /api/confirmations",
    "POST /api/admin/login",
  ]);
  // Next caches a variant under the format it picks from Accept, so only Chromium's header warms the browser's copy.
  for (const image of requests.filter(({ url }) => url.startsWith("/_next/image?"))) expect(image.accept).toBe(CHROMIUM_IMAGE_ACCEPT);
  expect(requests.find(({ url }) => url === "/operator")?.cookie).toBe("cd_admin=fixture-session");
  expect(requests.find(({ url }) => url === "/")?.cookie).toBeUndefined();
});

test("the warm-up covers every server a suite starts", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const first = await serve(fixtureSite);
  const second = await serve(fixtureSite);

  await warmUp(config(first.baseURL, second.baseURL, first.baseURL), { pages: ["/"] });

  expect(first.requests.filter(({ url }) => url === "/")).toHaveLength(1);
  expect(second.requests.filter(({ url }) => url === "/")).toHaveLength(1);
});

test("an image candidate that is not an optimized image stops the run", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { baseURL } = await serve((req, res) => {
    if (req.url === "/_next/image?url=%2Fcard.png&w=32&q=75") res.writeHead(500, { "content-type": "text/plain" }).end("failed");
    else fixtureSite(req, res);
  });

  await expect(warmUp(config(baseURL), { pages: ["/"] })).rejects.toThrow(
    "Warm-up expected an optimized image for /_next/image?url=%2Fcard.png&w=32&q=75; received HTTP 500, text/plain, 6 bytes.",
  );
});
