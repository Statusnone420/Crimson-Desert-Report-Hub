import "server-only";

import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/site";
import { turnstileHostnames } from "@/lib/turnstile";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function localRequest(request: URL): boolean {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production"
    && LOOPBACK_HOSTS.includes(request.hostname);
}

export function problemResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  } });
}

export function problemSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const origin = request.headers.get("origin") ?? "";
    const target = new URL(request.url);
    const allowed = new Set([...turnstileHostnames()].map((host) => `https://${host}`));
    // Next's development request URL can use localhost when the browser uses
    // 127.0.0.1. Permit only loopback aliases on that same development port.
    if (localRequest(target)) {
      for (const host of LOOPBACK_HOSTS) allowed.add(`${target.protocol}//${host}${target.port ? `:${target.port}` : ""}`);
    }
    return allowed.has(origin);
  } catch { return false; }
}

/** Bound actual streamed bytes, including requests without Content-Length. */
export async function readProblemJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new Error("json_required");
  }
  if (!request.body || Number(request.headers.get("content-length")) > 16384) throw new Error("invalid_request");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new Error("invalid_request"); }
      body += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}

export function problemPageUrl(value: string, requestUrl: string): string | null {
  try {
    const page = new URL(value);
    const target = new URL(requestUrl);
    if (page.username || page.password) return null;
    const local = localRequest(target) && LOOPBACK_HOSTS.includes(page.hostname)
      && page.port === target.port && page.protocol === target.protocol && ["http:", "https:"].includes(page.protocol);
    if (!local && (page.protocol !== "https:" || page.port || !turnstileHostnames().has(page.hostname))) return null;
    // Query strings/fragments can contain tokens or personal information.
    return `${local ? page.origin : SITE_URL}${page.pathname}`;
  } catch { return null; }
}
