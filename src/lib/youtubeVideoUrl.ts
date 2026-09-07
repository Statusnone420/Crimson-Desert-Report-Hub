/** YouTube video IDs are eleven Base64url characters. */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type ParsedYouTubeVideo =
  | { ok: true; videoId: string; canonicalUrl: string }
  | { ok: false; reason: "invalid_url" | "unsupported_host" | "invalid_video_id" };

function withHttps(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return YOUTUBE_HOSTS.has(host);
}

function videoIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && YOUTUBE_VIDEO_ID.test(parts[0] ?? "")) return parts[0] ?? null;
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) {
    const candidate = parts[1]?.split("&")[0] ?? "";
    return YOUTUBE_VIDEO_ID.test(candidate) ? candidate : null;
  }
  return null;
}

export function canonicalYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Accept common YouTube watch, short, embed, live, and youtu.be forms.
 * Always canonicalize to https://www.youtube.com/watch?v=ID. Reject every
 * other host — this is not an open URL fetcher.
 */
export function parseYouTubeVideoUrl(value: string): ParsedYouTubeVideo {
  if (!value.trim()) return { ok: false, reason: "invalid_url" };
  let parsed: URL;
  try {
    parsed = new URL(withHttps(value));
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "invalid_url" };
  if (parsed.username || parsed.password || parsed.port) return { ok: false, reason: "invalid_url" };
  if (!hostAllowed(parsed.hostname)) return { ok: false, reason: "unsupported_host" };

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  let videoId: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = videoIdFromPath(parsed.pathname);
  } else {
    const fromQuery = parsed.searchParams.get("v");
    if (fromQuery && YOUTUBE_VIDEO_ID.test(fromQuery)) videoId = fromQuery;
    else videoId = videoIdFromPath(parsed.pathname);
  }

  if (!videoId) return { ok: false, reason: "invalid_video_id" };
  return { ok: true, videoId, canonicalUrl: canonicalYouTubeWatchUrl(videoId) };
}

export function videoIdFromCanonicalWatchUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get("v");
    if (parsed.hostname.replace(/^www\./, "") !== "youtube.com") return null;
    if (parsed.pathname !== "/watch" || !videoId || !YOUTUBE_VIDEO_ID.test(videoId)) return null;
    return videoId;
  } catch {
    return null;
  }
}
