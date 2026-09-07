import { describe, expect, it } from "vitest";
import { reviewedCoverage } from "@/lib/editorialCoverage";
import { getWatchSelections, officialWatchSelection } from "@/lib/watchSelections";
import { buildVideoPublicationDraft } from "@/lib/videoPublicationDraft";
import type { NormalizedVideoReviewCandidate } from "@/lib/videoReview";

const now = new Date("2026-09-05T23:00:00.000Z");

const candidate: NormalizedVideoReviewCandidate = {
  videoId: "zzDraftMock",
  canonicalUrl: "https://www.youtube.com/watch?v=zzDraftMock",
  submittedUrl: "https://youtu.be/zzDraftMock",
  sourceId: "khraze-gaming",
  creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
  title: "Crimson Desert fixture commentary",
  channelLabel: "FixtureChannel",
  reviewNote: "Invented review note that must stay private.",
  reviewedHeadline: "Fixture creator reads the expansion",
  reviewedExcerpt: "Crimson Desert fixture excerpt for a later publication PR.",
  excerptReviewStatus: "reviewed",
  topic: "expansion",
  publishedAt: "2026-07-17",
};

describe("publication draft", () => {
  it("lists missing later-PR requirements without changing Watch", () => {
    const before = getWatchSelections(now);
    const draft = buildVideoPublicationDraft(candidate, { now });
    expect(draft.completeness).toBe("incomplete");
    expect(draft.missingRequirements.some((item) => item.includes("verifiedVideoIds"))).toBe(true);
    expect(draft.missingRequirements.some((item) => item.includes("reviewedCoverage"))).toBe(true);
    expect(draft.missingRequirements.some((item) => item.includes("public/watch/zzDraftMock.jpg"))).toBe(true);
    expect(draft.missingRequirements.some((item) => item.includes("CREATOR_STILLS"))).toBe(true);
    expect(draft.markdown).toContain("Approval did not publish this video");
    expect(draft.markdown).toContain(officialWatchSelection.url);
    expect(draft.markdown).toContain("Do not mark the source `enabled: false` to pause it.");
    expect(getWatchSelections(now)).toEqual(before);
    expect(reviewedCoverage.map((item) => item.url)).toEqual([
      "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
      "https://www.pcgamer.com/games/action/crimson-deserts-upcoming-dlc-decides-its-the-sims-now-i-guess/",
      "https://www.youtube.com/watch?v=6H6c0S80d4U",
    ]);
  });
});
