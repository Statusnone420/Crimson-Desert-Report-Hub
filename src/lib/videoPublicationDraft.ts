import { reviewedCoverage } from "@/lib/editorialCoverage";
import { editorialSourceById } from "@/lib/editorialSources";
import {
  validateEditorialPublication,
  type EditorialPublicationCandidate,
} from "@/lib/editorialPublication";
import {
  alreadyPublishedWatchVideoIds,
  localWatchStillExists,
  localWatchStillPath,
  type NormalizedVideoReviewCandidate,
} from "@/lib/videoReview";
import { creatorStillForVideoId, officialWatchSelection } from "@/lib/watchSelections";

export type PublicationDraftCompleteness = "complete" | "incomplete";

export type VideoPublicationDraft = {
  videoId: string;
  canonicalUrl: string;
  completeness: PublicationDraftCompleteness;
  missingRequirements: string[];
  proposedCoverage: EditorialPublicationCandidate;
  markdown: string;
};

const STILL_REQUIREMENT =
  "Add a local 1280×720 still at the path below and map it in CREATOR_STILLS. This inbox does not fetch or store images.";

export function buildVideoPublicationDraft(
  candidate: NormalizedVideoReviewCandidate,
  options: { now?: Date; cwd?: string } = {},
): VideoPublicationDraft {
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const source = editorialSourceById(candidate.sourceId);
  const missing: string[] = [];

  const proposedCoverage: EditorialPublicationCandidate = {
    sourceId: candidate.sourceId,
    sourceTitle: candidate.title,
    reviewedHeadline: candidate.reviewedHeadline ?? candidate.title,
    reviewedExcerpt: candidate.reviewedExcerpt,
    excerptReviewStatus: candidate.excerptReviewStatus,
    type: "video",
    topic: candidate.topic,
    url: candidate.canonicalUrl,
    publishedAt: candidate.publishedAt,
    creatorChannelId: candidate.creatorChannelId,
  };

  if (!source) missing.push("Registered creator source is missing.");
  if (source && !source.enabled) {
    missing.push(
      "Source is disabled. Do not use enabled:false as a pause while leaving a selected Watch entry.",
    );
  }
  if (source && !(source.verifiedVideoIds ?? []).includes(candidate.videoId)) {
    missing.push(
      `Add this video ID to verifiedVideoIds for ${candidate.sourceId}. Approval covers this video only, not later uploads.`,
    );
  }
  if (!reviewedCoverage.some((item) => item.url === candidate.canonicalUrl)) {
    missing.push("Add a reviewedCoverage entry for this single video. Do not add the whole channel.");
  }
  if (!localWatchStillExists(candidate.videoId, cwd)) {
    missing.push(`${STILL_REQUIREMENT} Missing file: ${localWatchStillPath(candidate.videoId)}`);
  }
  if (!creatorStillForVideoId(candidate.videoId)) {
    missing.push(`Add CREATOR_STILLS["${candidate.videoId}"] in src/lib/watchSelections.ts.`);
  }

  const publication = validateEditorialPublication(proposedCoverage, {
    now,
    knownCanonicalUrls: reviewedCoverage.map((item) => item.url),
  });
  if (!publication.ok) {
    missing.push(`Current publication validation fails with ${publication.reason} until the later PR supplies the missing register fields.`);
  }

  if (alreadyPublishedWatchVideoIds().includes(candidate.videoId)) {
    missing.push("This video is already on Watch. A later PR should not duplicate it.");
  }

  const completeness: PublicationDraftCompleteness = missing.length === 0 ? "complete" : "incomplete";
  const markdown = renderDraftMarkdown({
    candidate,
    proposedCoverage,
    missing,
    completeness,
  });

  return {
    videoId: candidate.videoId,
    canonicalUrl: candidate.canonicalUrl,
    completeness,
    missingRequirements: missing,
    proposedCoverage,
    markdown,
  };
}

function renderDraftMarkdown(input: {
  candidate: NormalizedVideoReviewCandidate;
  proposedCoverage: EditorialPublicationCandidate;
  missing: string[];
  completeness: PublicationDraftCompleteness;
}): string {
  const { candidate, proposedCoverage, missing, completeness } = input;
  const still = localWatchStillPath(candidate.videoId);
  const coverageLiteral = JSON.stringify(proposedCoverage, null, 2);
  const missingBlock =
    missing.length === 0
      ? "- None. A later publication PR can apply these register and still changes."
      : missing.map((item) => `- ${item}`).join("\n");

  return `# Private publication draft

This file is a later-PR checklist. Approval did not publish this video, change Watch, or update a public registry.

- Title: ${candidate.title}
- Channel: ${candidate.channelLabel}
- Canonical URL: ${candidate.canonicalUrl}
- Source: ${candidate.sourceId}
- Completeness: ${completeness}
- Official Watch contract: unchanged (${officialWatchSelection.url})

## Reviewed excerpt

${candidate.reviewedExcerpt ?? "_No reviewed excerpt yet._"}

## Proposed later PR changes

### 1. \`src/lib/editorialSources.ts\`

Add \`${candidate.videoId}\` to \`${candidate.sourceId}.verifiedVideoIds\`. Do not mark the source \`enabled: false\` to pause it.

### 2. \`src/lib/editorialCoverage.ts\`

Add this reviewed coverage object (one video, not the channel):

\`\`\`json
${coverageLiteral}
\`\`\`

### 3. \`src/lib/watchSelections.ts\`

Add \`CREATOR_STILLS["${candidate.videoId}"]\` pointing at \`/${still.replace(/^public\//, "")}\`.

### 4. Local still

Required file: \`${still}\` (1280×720). This inbox does not download, store, or invent a still.

## Missing requirements

${missingBlock}

## Review note (private)

${candidate.reviewNote}
`;
}
