import { describe, expect, it, vi } from "vitest";
import {
  discoverEditorialYoutube,
  type EditorialYoutubeCandidate,
} from "@/lib/editorialYoutube";

const CHANNEL = "UCFXUSG_393wZJaRTErU6Pjw";
const OTHER_CHANNEL = "UC1234567890123456789012";

function feed(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Channel</title>${entries}</feed>`;
}

function entry({
  videoId = "abcdefghijk",
  channelId = CHANNEL,
  title = "Crimson Desert update",
  published = "2026-09-05T12:00:00+00:00",
  href = `https://www.youtube.com/watch?v=${videoId}`,
}: Partial<{ videoId: string; channelId: string; title: string; published: string; href: string }> = {}): string {
  return `<entry><yt:videoId>${videoId}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><published>${published}</published><link rel="alternate" href="${href}" /></entry>`;
}

function fetchResponse(xml: string, status = 200): typeof fetch {
  return vi.fn(async () => new Response(xml, { status, headers: { "content-type": "application/atom+xml" } })) as unknown as typeof fetch;
}

async function discover(xml: string): Promise<EditorialYoutubeCandidate[]> {
  return discoverEditorialYoutube({ allowedChannelId: CHANNEL, fetchImpl: fetchResponse(xml) });
}

describe("discoverEditorialYoutube", () => {
  it("returns an empty result for a valid empty feed", async () => {
    await expect(discover(feed(""))).resolves.toEqual([]);
  });

  it("surfaces fetch failures instead of treating them as no videos", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await expect(discoverEditorialYoutube({ allowedChannelId: CHANNEL, fetchImpl })).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("surfaces a request timeout", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await expect(discoverEditorialYoutube({ allowedChannelId: CHANNEL, timeoutMs: 5, fetchImpl })).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects non-success responses, malformed XML, and oversized feeds", async () => {
    await expect(discoverEditorialYoutube({ allowedChannelId: CHANNEL, fetchImpl: fetchResponse("no", 503) })).rejects.toMatchObject({ code: "http_error" });
    await expect(discover("<feed><entry>")).rejects.toMatchObject({ code: "malformed_feed" });
    await expect(discoverEditorialYoutube({ allowedChannelId: CHANNEL, maxBytes: 10, fetchImpl: fetchResponse(feed("")) })).rejects.toMatchObject({ code: "oversize" });
    const htmlResponse = new Response("<html>not an Atom feed</html>", { headers: { "content-type": "text/html" } });
    await expect(discoverEditorialYoutube({ allowedChannelId: CHANNEL, fetchImpl: vi.fn(async () => htmlResponse) as unknown as typeof fetch })).rejects.toMatchObject({ code: "malformed_feed" });
  });

  it("keeps only exact-channel, date-valid, editorial-title candidates", async () => {
    const candidates = await discover(feed([
      entry(),
      entry({ videoId: "lmnopqrstuv", channelId: OTHER_CHANNEL }),
      entry({ videoId: "mnopqrstuvw", title: "Unrelated game review" }),
      entry({ videoId: "nopqrstuvwx", published: "not-a-date" }),
    ].join("")));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      videoId: "abcdefghijk",
      channelId: CHANNEL,
      title: "Crimson Desert update",
      publishedAt: "2026-09-05T12:00:00.000Z",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
    });
  });

  it("decodes XML entities and rejects malformed or mismatched URLs", async () => {
    const candidates = await discover(feed([
      entry({ videoId: "abcdefghijk", title: "Crimson Desert &amp; Charting the Unknown" }),
      entry({ videoId: "bcdefghijkl", href: "http://www.youtube.com/watch?v=bcdefghijkl" }),
      entry({ videoId: "cdefghijklm", href: "https://www.youtube.com/shorts/cdefghijklm" }),
      entry({ videoId: "defghijklmn", href: "https://www.youtube.com/watch?v=othervideo" }),
      entry({ videoId: "efghijklmno", href: "https://user:pass@www.youtube.com/watch?v=efghijklmno" }),
      entry({ videoId: "fghijklmnop", href: "https://www.youtube.com:443/watch?v=fghijklmnop" }),
    ].join("")));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("Crimson Desert & Charting the Unknown");
  });

  it("deduplicates valid entries by video ID", async () => {
    const candidates = await discover(feed([entry(), entry({ title: "Charting the Unknown — duplicate" })].join("")));
    expect(candidates).toHaveLength(1);
  });

  it("rejects a missing or unsupported YouTube namespace and malformed calendar dates", async () => {
    await expect(discover(feed(entry({ published: "2026-02-30T12:00:00Z" })))).resolves.toEqual([]);
    await expect(discover('<feed xmlns:yt="https://example.test/yt"></feed>')).rejects.toMatchObject({ code: "malformed_feed" });
    await expect(discover("<feed><entry></feed>")).rejects.toMatchObject({ code: "malformed_feed" });
  });
});
