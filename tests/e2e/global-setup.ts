import type { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Image readiness requires the Playwright baseURL.");

  // This mobile image variant stalled across 18 CI tests. Complete its first
  // optimization before browser navigation can cancel an in-flight request.
  const url = new URL("/_next/image?url=%2Fofficial%2Fcontent.jpg&w=1080&q=75", baseURL);
  try {
    const response = await fetch(url, {
      headers: {
        // MIME type is part of Next's image cache key; match Chromium's request.
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.arrayBuffer();
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/webp" || body.byteLength === 0) {
      throw new Error(`Expected a complete WebP image; received HTTP ${response.status}, ${response.headers.get("content-type")}, ${body.byteLength} bytes.`);
    }
  } catch (cause) {
    throw new Error(`Image readiness failed for ${url.pathname}${url.search} (30-second limit).`, { cause });
  }
}
