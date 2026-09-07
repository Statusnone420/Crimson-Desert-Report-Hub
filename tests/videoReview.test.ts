import { describe, expect, it } from "vitest";
import { alreadyPublishedWatchVideoIds, validateVideoReviewCandidate, videoReviewRejectionMessage } from "@/lib/videoReview";

const valid = {
  url: "https://youtu.be/zzInboxMock",
  sourceId: "khraze-gaming",
  title: "Crimson Desert fixture commentary",
  channelLabel: "KhrazeGaming",
  reviewNote: "Owner wants a later publication PR for this one video.",
  creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
  reviewedHeadline: "Fixture creator reads the expansion",
  reviewedExcerpt: "Crimson Desert fixture excerpt.",
  excerptReviewStatus: "reviewed" as const,
  publishedAt: "2026-07-18",
};

describe("video review candidate validation", () => {
  it("normalizes a youtu.be link against the registered creator source", () => {
    expect(validateVideoReviewCandidate(valid)).toMatchObject({
      ok: true,
      candidate: {
        videoId: "zzInboxMock",
        canonicalUrl: "https://www.youtube.com/watch?v=zzInboxMock",
        sourceId: "khraze-gaming",
        creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
      },
    });
  });

  it("rejects the two videos already on Watch", () => {
    expect(alreadyPublishedWatchVideoIds().sort()).toEqual(["6H6c0S80d4U", "HaCtG1F_hfE"].sort());
    expect(validateVideoReviewCandidate({ ...valid, url: "https://www.youtube.com/watch?v=6H6c0S80d4U" })).toEqual({
      ok: false,
      reason: "already_on_watch",
    });
    expect(validateVideoReviewCandidate({ ...valid, url: "https://www.youtube.com/watch?v=HaCtG1F_hfE" })).toEqual({
      ok: false,
      reason: "already_on_watch",
    });
  });

  it("reuses source and channel checks instead of discovering creators", () => {
    expect(validateVideoReviewCandidate({ ...valid, sourceId: "pearl-abyss-crimson-desert" })).toEqual({
      ok: false,
      reason: "source_not_creator",
    });
    expect(validateVideoReviewCandidate({ ...valid, creatorChannelId: "UCanotherchannel00000000000" })).toEqual({
      ok: false,
      reason: "invalid_creator_channel",
    });
    expect(validateVideoReviewCandidate({ ...valid, sourceId: "unknown" })).toEqual({
      ok: false,
      reason: "unknown_source",
    });
    expect(videoReviewRejectionMessage("unsupported_host")).toMatch(/YouTube/);
  });
});
