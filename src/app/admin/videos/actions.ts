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
  archiveVideoReviewCandidate,
  insertVideoReviewCandidate,
  restoreVideoReviewCandidate,
  skipVideoReviewCandidate,
  updateVideoReviewCandidate,
} from "@/lib/videoReviewStore";

import type { VideoActionState } from "@/lib/videoReviewActionState";

class VideoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoInputError";
  }
}

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

function checkedCandidateFromForm(formData: FormData) {
  const validated = candidateFromForm(formData);
  if (!validated.ok) throw new VideoInputError(videoReviewRejectionMessage(validated.reason));
  return validated.candidate;
}

function refreshInbox(): void {
  revalidatePath("/admin/videos");
  revalidatePath("/operator");
}

export async function addVideoReviewCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const candidate = checkedCandidateFromForm(formData);
  try {
    await insertVideoReviewCandidate(createServiceClient(), candidate);
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
  const candidate = checkedCandidateFromForm(formData);
  try {
    await updateVideoReviewCandidate(createServiceClient(), id, revision, candidate);
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

export async function archiveVideoCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) throw new Error("bad input");
  await archiveVideoReviewCandidate(createServiceClient(), id, revision);
  refreshInbox();
}

export async function restoreVideoCandidate(formData: FormData): Promise<void> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) throw new Error("bad input");
  await restoreVideoReviewCandidate(createServiceClient(), id, revision);
  refreshInbox();
}

function actionSuccess(message: string): VideoActionState {
  return { status: "success", code: "none", message };
}

function actionError(
  code: Exclude<VideoActionState["code"], "none">,
  message: string,
): VideoActionState {
  return { status: "error", code, message };
}

function stateMutationError(error: unknown): VideoActionState | null {
  if (error instanceof VideoInputError) return actionError("validation", error.message);
  if (error instanceof StaleVideoReviewEdit) {
    return actionError("stale", "This candidate changed elsewhere. Your entered details are still here; reload before trying again.");
  }
  if (error instanceof DuplicateVideoReviewCandidate) {
    return actionError("duplicate", "This video is already in the private inbox. Your entered details are still here.");
  }
  if (error instanceof Error && /^(Restore this archived draft|This draft is archived|This video already has a publication draft|Only a ready publication draft|Only an archived draft)/.test(error.message)) {
    return actionError("invalid_state", "This candidate cannot take that action in its current state. Reload and try again.");
  }
  if (error instanceof Error && /^(video candidate|video review inbox|publication draft|existing video candidate)/.test(error.message)) {
    return actionError("unavailable", "The private inbox could not save that change. Your entered details are still here; try again.");
  }
  return null;
}

async function recoverVideoAction(
  run: () => Promise<void | number>,
  successMessage: string,
): Promise<VideoActionState> {
  let savedRevision: void | number;
  try {
    savedRevision = await run();
  } catch (error) {
    const state = stateMutationError(error);
    if (state) return state;
    throw error;
  }
  refreshInbox();
  return { ...actionSuccess(successMessage), ...(savedRevision === undefined ? {} : { savedRevision }) };
}

/**
 * Client form adapters return expected write outcomes instead of replacing the
 * workspace. Authentication and preview protection deliberately run first.
 */
export async function addVideoReviewCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  return recoverVideoAction(
    async () => insertVideoReviewCandidate(createServiceClient(), checkedCandidateFromForm(formData)).then(() => undefined),
    "Added to the private inbox.",
  );
}

export async function saveVideoReviewCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) return actionError("validation", "The video review form is incomplete. Reload and try again.");
  return recoverVideoAction(
    async () => updateVideoReviewCandidate(createServiceClient(), id, revision, checkedCandidateFromForm(formData)).then((candidate) => candidate.revision),
    "Saved private video review.",
  );
}

export async function approveVideoCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) return actionError("validation", "The video review form is incomplete. Reload and try again.");
  return recoverVideoAction(
    async () => approveVideoReviewCandidate(createServiceClient(), id, revision).then(() => undefined),
    "Private draft prepared. Watch remains unchanged.",
  );
}

export async function skipVideoCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) return actionError("validation", "The video review form is incomplete. Reload and try again.");
  return recoverVideoAction(
    async () => skipVideoReviewCandidate(createServiceClient(), id, revision).then(() => undefined),
    "Candidate kept private.",
  );
}

export async function archiveVideoCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) return actionError("validation", "The video review form is incomplete. Reload and try again.");
  return recoverVideoAction(
    async () => archiveVideoReviewCandidate(createServiceClient(), id, revision).then(() => undefined),
    "Private draft archived.",
  );
}

export async function restoreVideoCandidateState(
  _previous: VideoActionState,
  formData: FormData,
): Promise<VideoActionState> {
  await requireAdmin("/admin/videos");
  assertProductionWriteAllowed();
  const id = formText(formData, "id");
  const revision = Number(formText(formData, "revision"));
  if (!id || !Number.isInteger(revision)) return actionError("validation", "The video review form is incomplete. Reload and try again.");
  return recoverVideoAction(
    async () => restoreVideoReviewCandidate(createServiceClient(), id, revision).then(() => undefined),
    "Private draft restored.",
  );
}
