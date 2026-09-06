import { validateEditorialPublication, type EditorialPublicationCandidate } from "@/lib/editorialPublication";

// Reviewed selections. Discovery output cannot enter this register automatically.
export const reviewedCoverage = [
  {
    sourceId: "pearl-abyss-crimson-desert",
    sourceTitle: "Charting the Unknown: DLC Pre-Orders Opening Soon",
    reviewedHeadline: "Pearl Abyss sets the expansion’s release schedule",
    reviewedExcerpt: "The Crimson Desert announcement lists regional launch times and pre-order details. The Mac App Store version will not be available at launch.",
    excerptReviewStatus: "reviewed",
    type: "article",
    topic: "expansion",
    url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
    publishedAt: "2026-09-03T14:00:00Z",
  },
  {
    sourceId: "pc-gamer",
    sourceTitle: "Crimson Desert's upcoming DLC decides it's The Sims now, I guess",
    reviewedHeadline: "PC Gamer takes a closer look at the housing reveal",
    reviewedExcerpt: "Mollie Taylor examines the building tools shown in Crimson Desert’s expansion trailer and shares her reaction to the new housing features.",
    excerptReviewStatus: "reviewed",
    type: "article",
    topic: "expansion",
    url: "https://www.pcgamer.com/games/action/crimson-deserts-upcoming-dlc-decides-its-the-sims-now-i-guess/",
    publishedAt: "2026-09-03",
  },
  {
    sourceId: "khraze-gaming",
    sourceTitle: "Crimson Desert: Charting the Unknown DLC - First Details Gameplay, Ship Navigation & More",
    reviewedHeadline: "KhrazeGaming breaks down the expansion reveal",
    reviewedExcerpt: "KhrazeGaming’s video covers the first Crimson Desert expansion details, including ship navigation and new islands. Watch the creator’s take alongside the official announcement.",
    excerptReviewStatus: "reviewed",
    type: "video",
    topic: "expansion",
    url: "https://www.youtube.com/watch?v=6H6c0S80d4U",
    publishedAt: "2026-09-03T18:35:11Z",
    creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
  },
] as const satisfies readonly EditorialPublicationCandidate[];

export function getEditorialCoverage(now = new Date()) {
  const knownCanonicalUrls: string[] = [];
  return reviewedCoverage.flatMap((candidate) => {
    // A future selection stays unpublished until its actual source date.
    if (Date.parse(candidate.publishedAt) > now.getTime()) return [];
    const result = validateEditorialPublication(candidate, { now, knownCanonicalUrls });
    if (!result.ok) throw new Error(`Invalid reviewed coverage ${candidate.sourceId}: ${result.reason}`);
    knownCanonicalUrls.push(result.publication.url);
    return [result.publication];
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
