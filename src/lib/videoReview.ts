import { existsSync } from "node:fs";
import path from "node:path";
import { editorialSourceById, EDITORIAL_SOURCES, type EditorialSource } from "@/lib/editorialSources";
import { officialWatchSelection } from "@/lib/watchSelections";
import { parseYouTubeVideoUrl, videoIdFromCanonicalWatchUrl } from "@/lib/youtubeVideoUrl";

export const VIDEO_REVIEW_STATES = ["pending", "skipped", "draft_ready"] as const;
export type VideoReviewState = (typeof VIDEO_REVIEW_STATES)[number];

export const EXCERPT_REVIEW_STATUSES = ["unreviewed", "reviewed"] as const;
export type ExcerptReviewStatus = (typeof EXCERPT_REVIEW_STATUSES)[number];

export const VIDEO_REVIEW_TOPICS = ["base_game", "expansion"] as const;
export type VideoReviewTopic = (typeof VIDEO_REVIEW_TOPICS)[number];

export type VideoReviewCandidateInput = {
  url: string;
  sourceId: string;
  title: string;
  channelLabel: string;
  reviewNote: string;
  creatorChannelId?: string | null;
  reviewedHeadline?: string | null;
  reviewedExcerpt?: string | null;
  excerptReviewStatus?: ExcerptReviewStatus;
  topic?: VideoReviewTopic;
  publishedAt?: string | null;
};

export type NormalizedVideoReviewCandidate = {
  videoId: string;
  canonicalUrl: string;
  submittedUrl: string;
  sourceId: string;
  creatorChannelId: string | null;
  title: string;
  channelLabel: string;
  reviewNote: string;
  reviewedHeadline: string | null;
  reviewedExcerpt: string | null;
  excerptReviewStatus: ExcerptReviewStatus;
  topic: VideoReviewTopic;
  publishedAt: string | null;
};

export type VideoReviewRejection =
  | "invalid_url"
  | "unsupported_host"
  | "invalid_video_id"
  | "unknown_source"
  | "source_not_creator"
  | "source_disabled"
  | "unverified_creator"
  | "invalid_creator_channel"
  | "already_on_watch"
  | "invalid_title"
  | "invalid_channel_label"
  | "invalid_review_note"
  | "invalid_excerpt";

export type VideoReviewValidation =
  | { ok: true; candidate: NormalizedVideoReviewCandidate }
  | { ok: false; reason: VideoReviewRejection };

const HTML_LIKE = /<[^>]+>/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function cleanText(value: string | null | undefined, maximumLength: number): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximumLength || HTML_LIKE.test(normalized)) return null;
  return normalized;
}

export function creatorEditorialSources(): EditorialSource[] {
  return EDITORIAL_SOURCES.filter((source) => source.kind === "creator");
}

export function alreadyPublishedWatchVideoIds(): string[] {
  const ids = new Set<string>();
  const officialId = videoIdFromCanonicalWatchUrl(officialWatchSelection.url);
  if (officialId) ids.add(officialId);
  for (const source of EDITORIAL_SOURCES as readonly EditorialSource[]) {
    for (const videoId of source.verifiedVideoIds ?? []) ids.add(videoId);
  }
  return [...ids];
}

export function localWatchStillPath(videoId: string): string {
  return path.join("public", "watch", `${videoId}.jpg`);
}

export function localWatchStillExists(videoId: string, cwd = process.cwd()): boolean {
  return existsSync(path.join(cwd, localWatchStillPath(videoId)));
}

export function validateVideoReviewCandidate(input: VideoReviewCandidateInput): VideoReviewValidation {
  const parsed = parseYouTubeVideoUrl(input.url);
  if (!parsed.ok) return parsed;

  if (alreadyPublishedWatchVideoIds().includes(parsed.videoId)) {
    return { ok: false, reason: "already_on_watch" };
  }

  const source = editorialSourceById(input.sourceId);
  if (!source) return { ok: false, reason: "unknown_source" };
  if (source.kind !== "creator") return { ok: false, reason: "source_not_creator" };
  if (!source.enabled) return { ok: false, reason: "source_disabled" };
  if (!source.verifiedChannelId) return { ok: false, reason: "unverified_creator" };

  const creatorChannelId = cleanText(input.creatorChannelId ?? source.verifiedChannelId, 24);
  if (!creatorChannelId || !CHANNEL_ID.test(creatorChannelId) || creatorChannelId !== source.verifiedChannelId) {
    return { ok: false, reason: "invalid_creator_channel" };
  }

  const title = cleanText(input.title, 240);
  if (!title) return { ok: false, reason: "invalid_title" };
  const channelLabel = cleanText(input.channelLabel, 120);
  if (!channelLabel) return { ok: false, reason: "invalid_channel_label" };
  const reviewNote = cleanText(input.reviewNote, 500);
  if (!reviewNote) return { ok: false, reason: "invalid_review_note" };

  const excerptReviewStatus = input.excerptReviewStatus ?? "unreviewed";
  const reviewedHeadline = input.reviewedHeadline?.trim() ? cleanText(input.reviewedHeadline, 240) : null;
  const reviewedExcerpt = input.reviewedExcerpt?.trim() ? cleanText(input.reviewedExcerpt, 500) : null;
  if (input.reviewedHeadline?.trim() && !reviewedHeadline) return { ok: false, reason: "invalid_title" };
  if (input.reviewedExcerpt?.trim() && !reviewedExcerpt) return { ok: false, reason: "invalid_excerpt" };

  const topic = input.topic ?? "expansion";
  if (!(VIDEO_REVIEW_TOPICS as readonly string[]).includes(topic)) return { ok: false, reason: "invalid_title" };

  return {
    ok: true,
    candidate: {
      videoId: parsed.videoId,
      canonicalUrl: parsed.canonicalUrl,
      submittedUrl: input.url.trim(),
      sourceId: source.id,
      creatorChannelId,
      title,
      channelLabel,
      reviewNote,
      reviewedHeadline,
      reviewedExcerpt,
      excerptReviewStatus,
      topic,
      publishedAt: input.publishedAt?.trim() ? input.publishedAt.trim() : null,
    },
  };
}

export function videoReviewRejectionMessage(reason: VideoReviewRejection): string {
  switch (reason) {
    case "invalid_url":
      return "That does not look like a YouTube video URL.";
    case "unsupported_host":
      return "Only YouTube video URLs are accepted.";
    case "invalid_video_id":
      return "The YouTube video ID could not be read.";
    case "unknown_source":
      return "Pick a registered creator source.";
    case "source_not_creator":
      return "Official Watch videos stay on their own contract. This inbox is for creator videos.";
    case "source_disabled":
      return "That source is disabled. Do not pause a source with enabled:false while leaving a selected entry.";
    case "unverified_creator":
      return "That source has no verified channel ID.";
    case "invalid_creator_channel":
      return "The channel ID must match the registered source channel.";
    case "already_on_watch":
      return "This video is already on Watch.";
    case "invalid_title":
      return "Title is required, plain text, and at most 240 characters.";
    case "invalid_channel_label":
      return "Channel label is required, plain text, and at most 120 characters.";
    case "invalid_review_note":
      return "A review note is required, plain text, and at most 500 characters.";
    case "invalid_excerpt":
      return "The excerpt must be plain text and at most 500 characters.";
  }
}
