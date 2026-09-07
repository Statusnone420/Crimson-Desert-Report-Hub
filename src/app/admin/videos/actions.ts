"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminGuard";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";
import {
  validateVideoReviewCandidate,
  videoReviewRejectionMessage,
  type ExcerptReviewStatus,
  type VideoReviewTopic,
} from "@/lib/videoReview";
import {
  DuplicateVideoReviewCandidate,
  StaleVideoReviewEdit,
  approveVideoReviewCandidate,
  insertVideoReviewCandidate,
  skipVideoReviewCandidate,
  updateVideoReviewCandidate,
} from "@/lib/videoReviewStore";

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function candidateFromForm(formData: FormData) {
  const excerptReviewStatus: ExcerptReviewStatus =
    formText(formData, "excerpt_review_status") === "reviewed" ? "reviewed" : "unreviewed";
  const topicValue = formText(formData, "topic");
  const topic: VideoReviewTopic = topicValue === "base_game" ? "base_game" : "expansion";
  return validateVideoReviewCandidate({
    url: formText(formData, "url"),
    sourceId: formText(formData, "source_id"),
    title: formText(formData, "title"),
    channelLabel: formText(formData, "channel_label"),
    reviewNote: formText(formData, "review_note"),
    creatorChannelId: null,
    reviewedHeadline: formText(formData, "reviewed_headline") || null,
    reviewedExcerpt: formText(formData, "reviewed_excerpt") || null,
    excerptReviewStatus,
    topic,
    publishedAt: formText(formData, "published_at") || null,
  });
}

function refreshInbox(): void {
  revalidatePath("/admin/videos");
}

export async function addVideoReviewCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const validated = candidateFromForm(formData);
  if (!validated.ok) throw new Error(videoReviewRejectionMessage(validated.reason));
  try {
    await insertVideoReviewCandidate(createServiceClient(), validated.candidate);
  } catch (error) {
    if (error instanceof DuplicateVideoReviewCandidate) throw error;
    throw error;
  }
  refreshInbox();
}

export async function saveVideoReviewCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) throw new Error("bad input");
  const validated = candidateFromForm(formData);
  if (!validated.ok) throw new Error(videoReviewRejectionMessage(validated.reason));
  try {
    await updateVideoReviewCandidate(createServiceClient(), id, revision, validated.candidate);
  } catch (error) {
    if (error instanceof StaleVideoReviewEdit) throw error;
    throw error;
  }
  refreshInbox();
}

export async function approveVideoCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) throw new Error("bad input");
  await approveVideoReviewCandidate(createServiceClient(), id, revision);
  refreshInbox();
}

export async function skipVideoCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) throw new Error("bad input");
  await skipVideoReviewCandidate(createServiceClient(), id, revision);
  refreshInbox();
}
