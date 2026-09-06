import { describe, expect, it } from "vitest";
import { canonicalEditorialUrl, validateEditorialPublication, type EditorialPublicationCandidate } from "@/lib/editorialPublication";

const now = new Date("2026-09-05T12:00:00.000Z");

function candidate(overrides: Partial<EditorialPublicationCandidate> = {}): EditorialPublicationCandidate {
  return {
    sourceId: "pc-gamer",
    sourceTitle: "Crimson Desert's upcoming DLC decides it's The Sims now, I guess",
    reviewedHeadline: "Crimson Desert expansion adds a settlement system",
    reviewedExcerpt: "Crimson Desert expansion coverage describes the new settlement system.",
    excerptReviewStatus: "reviewed",
    type: "article",
    topic: "expansion",
    url: "https://www.pcgamer.com/games/action/crimson-deserts-upcoming-dlc-decides-its-the-sims-now-i-guess/?utm_source=newsletter",
    publishedAt: "2026-09-03",
    ...overrides,
  };
}

describe("editorial publication contract", () => {
  it("returns only reviewed public fields and preserves a date-only source date", () => {
    expect(validateEditorialPublication(candidate(), { now })).toEqual({
      ok: true,
      publication: {
        sourceId: "pc-gamer",
        sourceKind: "press",
        sourceTitle: "Crimson Desert's upcoming DLC decides it's The Sims now, I guess",
        headline: "Crimson Desert expansion adds a settlement system",
        excerpt: "Crimson Desert expansion coverage describes the new settlement system.",
        type: "article",
        topic: "expansion",
        url: "https://www.pcgamer.com/games/action/crimson-deserts-upcoming-dlc-decides-its-the-sims-now-i-guess/",
        publishedAt: "2026-09-03",
      },
    });
  });

  it("accepts an expansion publication independently of the current patch date", () => {
    expect(validateEditorialPublication(candidate({ publishedAt: "2026-09-03" }), {
      now: new Date("2026-09-04T01:00:00.000Z"),
    })).toMatchObject({ ok: true, publication: { topic: "expansion", publishedAt: "2026-09-03" } });
  });

  it("preserves a verified official timestamp without treating it as a patch date", () => {
    expect(validateEditorialPublication(candidate({
      sourceId: "pearl-abyss-crimson-desert",
      sourceTitle: "Crimson Desert Notice 129",
      reviewedHeadline: "Crimson Desert expansion notice",
      reviewedExcerpt: "Crimson Desert published an official expansion notice.",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
      publishedAt: "2026-09-03T14:00:00Z",
    }), { now })).toMatchObject({
      ok: true,
      publication: { sourceId: "pearl-abyss-crimson-desert", publishedAt: "2026-09-03T14:00:00Z" },
    });
  });

  it("rejects raw Reddit issue material and other-game stories from a trusted source", () => {
    expect(validateEditorialPublication(candidate({
      sourceId: "reddit",
      sourceTitle: "Crimson Desert mount input lockup",
      reviewedHeadline: "Raw player complaint",
      reviewedExcerpt: "Crimson Desert player text copied from an unreviewed candidate.",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/example",
    }), { now })).toEqual({ ok: false, reason: "unknown_source" });
    expect(validateEditorialPublication(candidate({
      sourceTitle: "Another game gets a performance patch",
      reviewedHeadline: "A different game changes performance",
      reviewedExcerpt: "This story never names the tracked game.",
    }), { now })).toEqual({ ok: false, reason: "not_crimson_desert" });
    expect(validateEditorialPublication(candidate({
      sourceTitle: "Elden Ring expansion review",
      reviewedHeadline: "Crimson Desert expansion adds a settlement system",
      reviewedExcerpt: "Crimson Desert coverage cannot make an unrelated source story relevant.",
    }), { now })).toEqual({ ok: false, reason: "not_crimson_desert" });
  });

  it("rejects arbitrary YouTube videos and requires KhrazeGaming's verified channel ID", () => {
    expect(validateEditorialPublication(candidate({
      sourceId: "random-youtube",
      type: "video",
      url: "https://www.youtube.com/watch?v=untrusted",
    }), { now })).toEqual({ ok: false, reason: "unknown_source" });
    expect(validateEditorialPublication(candidate({
      sourceId: "khraze-gaming",
      type: "video",
      url: "https://www.youtube.com/watch?v=khraze12345",
      creatorChannelId: "UCanotherchannel",
    }), { now })).toEqual({ ok: false, reason: "invalid_creator_channel" });
    expect(validateEditorialPublication(candidate({
      sourceId: "khraze-gaming",
      type: "video",
      url: "https://www.youtube.com/watch?v=6H6c0S80d4U&feature=share",
      creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
    }), { now })).toMatchObject({
      ok: true,
      publication: { sourceId: "khraze-gaming", type: "video", url: "https://www.youtube.com/watch?v=6H6c0S80d4U" },
    });
    expect(validateEditorialPublication(candidate({
      sourceId: "khraze-gaming",
      type: "article",
      creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
    }), { now })).toEqual({ ok: false, reason: "invalid_type" });
    expect(validateEditorialPublication(candidate({
      sourceId: "khraze-gaming",
      type: "video",
      url: "https://www.youtube.com/watch?v=short",
      creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
    }), { now })).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("rejects a substituted video even when the candidate claims the verified channel", () => {
    expect(validateEditorialPublication(candidate({
      sourceId: "khraze-gaming",
      type: "video",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
    }), { now })).toEqual({ ok: false, reason: "unverified_creator_video" });
  });

  it("rejects unsafe URLs, invented dates, raw excerpts, boilerplate, and canonical duplicates", () => {
    expect(canonicalEditorialUrl("https://user:pass@www.pcgamer.com/crimson-desert")).toBeNull();
    expect(canonicalEditorialUrl("https://www.pcgamer.com:8443/crimson-desert")).toBeNull();
    expect(validateEditorialPublication(candidate({ url: "https://evil.pcgamer.com/crimson-desert" }), { now })).toEqual({ ok: false, reason: "disallowed_host" });
    expect(validateEditorialPublication(candidate({ publishedAt: null }), { now })).toEqual({ ok: false, reason: "missing_publication_time" });
    expect(validateEditorialPublication(candidate({ publishedAt: "2026-09-06" }), { now })).toEqual({ ok: false, reason: "invalid_publication_time" });
    expect(validateEditorialPublication(candidate({ publishedAt: "2026-02-30" }), { now })).toEqual({ ok: false, reason: "invalid_publication_time" });
    expect(validateEditorialPublication(candidate({ excerptReviewStatus: "unreviewed" }), { now })).toEqual({ ok: false, reason: "unreviewed_excerpt" });
    expect(validateEditorialPublication(candidate({ reviewedExcerpt: "Skip to main. More replies about Crimson Desert." }), { now })).toEqual({ ok: false, reason: "boilerplate" });
    expect(validateEditorialPublication(candidate(), {
      now,
      knownCanonicalUrls: ["https://www.pcgamer.com/games/action/crimson-deserts-upcoming-dlc-decides-its-the-sims-now-i-guess/"],
    })).toEqual({ ok: false, reason: "duplicate_url" });
  });
});
