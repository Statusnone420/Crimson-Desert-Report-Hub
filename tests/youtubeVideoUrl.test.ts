import { describe, expect, it } from "vitest";
import { canonicalYouTubeWatchUrl, parseYouTubeVideoUrl } from "@/lib/youtubeVideoUrl";

describe("YouTube video URL parsing", () => {
  it("accepts supported YouTube forms and canonicalizes the video ID", () => {
    const id = "abcdefghijk";
    const expected = canonicalYouTubeWatchUrl(id);
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&feature=share`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `www.youtube.com/watch?v=${id}`,
    ]) {
      expect(parseYouTubeVideoUrl(url)).toEqual({ ok: true, videoId: id, canonicalUrl: expected });
    }
  });

  it("rejects arbitrary hosts, credentials, and non-video paths", () => {
    expect(parseYouTubeVideoUrl("https://vimeo.com/123")).toEqual({ ok: false, reason: "unsupported_host" });
    expect(parseYouTubeVideoUrl("https://youtube.com.evil.example/watch?v=abcdefghijk")).toEqual({
      ok: false,
      reason: "unsupported_host",
    });
    expect(parseYouTubeVideoUrl("https://user:pass@www.youtube.com/watch?v=abcdefghijk")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
    expect(parseYouTubeVideoUrl("https://www.youtube.com/channel/UCFXUSG_393wZJaRTErU6Pjw")).toEqual({
      ok: false,
      reason: "invalid_video_id",
    });
    expect(parseYouTubeVideoUrl("https://www.youtube.com/watch?v=short")).toEqual({
      ok: false,
      reason: "invalid_video_id",
    });
  });
});
