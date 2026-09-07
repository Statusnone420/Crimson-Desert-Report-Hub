import "server-only";

import { isMissingSupabaseRelation, isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import type { createServiceClient } from "@/lib/supabase";
import { buildVideoPublicationDraft } from "@/lib/videoPublicationDraft";
import {
  type ExcerptReviewStatus,
  type NormalizedVideoReviewCandidate,
  type VideoReviewState,
  type VideoReviewTopic,
} from "@/lib/videoReview";

export type VideoReviewRow = {
  id: string;
  created_at: string;
  updated_at: string;
  revision: number;
  video_id: string;
  canonical_url: string;
  submitted_url: string;
  source_id: string;
  creator_channel_id: string | null;
  title: string;
  channel_label: string;
  review_note: string;
  reviewed_headline: string | null;
  reviewed_excerpt: string | null;
  excerpt_review_status: ExcerptReviewStatus;
  topic: VideoReviewTopic;
  published_at: string | null;
  state: VideoReviewState;
  skipped_at: string | null;
  approved_at: string | null;
};

export type VideoPublicationDraftRow = {
  id: string;
  created_at: string;
  updated_at: string;
  candidate_id: string;
  video_id: string;
  completeness: "complete" | "incomplete";
  missing_requirements: string[];
  markdown: string;
};

export type VideoReviewQueue =
  | {
      status: "ok";
      observedAt: string;
      candidates: VideoReviewRow[];
      draftsByCandidateId: Record<string, VideoPublicationDraftRow>;
    }
  | { status: "unavailable"; reason: "schema_missing" };

export class StaleVideoReviewEdit extends Error {
  constructor() {
    super("This candidate was updated elsewhere. Reload and try again.");
    this.name = "StaleVideoReviewEdit";
  }
}

export class DuplicateVideoReviewCandidate extends Error {
  readonly existingId: string;
  constructor(existingId: string) {
    super("This video is already in the private inbox.");
    this.name = "DuplicateVideoReviewCandidate";
    this.existingId = existingId;
  }
}

function throwReadError(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label} read failed: ${error.message}`);
}

function isUniqueViolation(error: { code?: string | null; message?: string | null } | null): boolean {
  return error?.code === "23505" || /duplicate key/i.test(error?.message ?? "");
}

function rowToNormalized(row: VideoReviewRow): NormalizedVideoReviewCandidate {
  return {
    videoId: row.video_id,
    canonicalUrl: row.canonical_url,
    submittedUrl: row.submitted_url,
    sourceId: row.source_id,
    creatorChannelId: row.creator_channel_id,
    title: row.title,
    channelLabel: row.channel_label,
    reviewNote: row.review_note,
    reviewedHeadline: row.reviewed_headline,
    reviewedExcerpt: row.reviewed_excerpt,
    excerptReviewStatus: row.excerpt_review_status,
    topic: row.topic,
    publishedAt: row.published_at,
  };
}

function insertPayload(candidate: NormalizedVideoReviewCandidate): Record<string, unknown> {
  return {
    video_id: candidate.videoId,
    canonical_url: candidate.canonicalUrl,
    submitted_url: candidate.submittedUrl,
    source_id: candidate.sourceId,
    creator_channel_id: candidate.creatorChannelId,
    title: candidate.title,
    channel_label: candidate.channelLabel,
    review_note: candidate.reviewNote,
    reviewed_headline: candidate.reviewedHeadline,
    reviewed_excerpt: candidate.reviewedExcerpt,
    excerpt_review_status: candidate.excerptReviewStatus,
    topic: candidate.topic,
    published_at: candidate.publishedAt,
    state: "pending",
  };
}

const VIDEO_REVIEW_PAGE_SIZE = 1000;

/** Read every page by immutable id; hosted PostgREST caps can be below the requested size. */
async function readAllVideoReviewPages<Row extends { id: string }>(
  supabase: ReturnType<typeof createServiceClient>,
  table: "video_review_candidates" | "video_publication_drafts",
  columns: string,
): Promise<{ rows: Row[] } | { error: { message: string; code?: string } }> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (;;) {
    const filtered = supabase.from(table).select(columns);
    const page = await (after === null ? filtered : filtered.gt("id", after))
      .order("id", { ascending: true })
      .limit(VIDEO_REVIEW_PAGE_SIZE);
    if (page.error) return { error: page.error };
    if (page.data === null) return { error: { message: "read returned no rows" } };
    const pageRows = page.data as unknown as Row[];
    if (pageRows.length === 0) return { rows };
    rows.push(...pageRows);
    after = pageRows[pageRows.length - 1].id;
  }
}

function byCreatedAtThenId(a: VideoReviewRow, b: VideoReviewRow): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
}

export async function readVideoReviewQueue(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<VideoReviewQueue> {
  const candidatesResult = await readAllVideoReviewPages<VideoReviewRow>(
    supabase,
    "video_review_candidates",
    "id, created_at, updated_at, revision, video_id, canonical_url, submitted_url, source_id, creator_channel_id, title, channel_label, review_note, reviewed_headline, reviewed_excerpt, excerpt_review_status, topic, published_at, state, skipped_at, approved_at",
  );

  if ("error" in candidatesResult) {
    if (isMissingSupabaseRelation(candidatesResult.error, "video_review_candidates")) {
      return { status: "unavailable", reason: "schema_missing" };
    }
    throw new Error(`video review queue read failed: ${candidatesResult.error.message}`);
  }
  const draftsResult = await readAllVideoReviewPages<VideoPublicationDraftRow>(
    supabase,
    "video_publication_drafts",
    "id, created_at, updated_at, candidate_id, video_id, completeness, missing_requirements, markdown",
  );

  if ("error" in draftsResult) {
    if (isMissingSupabaseRelation(draftsResult.error, "video_publication_drafts")) {
      return { status: "unavailable", reason: "schema_missing" };
    }
    throw new Error(`video publication drafts read failed: ${draftsResult.error.message}`);
  }
  const draftsByCandidateId: Record<string, VideoPublicationDraftRow> = {};
  for (const draft of draftsResult.rows) {
    draftsByCandidateId[draft.candidate_id] = draft;
  }

  return {
    status: "ok",
    observedAt: new Date().toISOString(),
    candidates: candidatesResult.rows.sort(byCreatedAtThenId),
    draftsByCandidateId,
  };
}

export async function insertVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: NormalizedVideoReviewCandidate,
): Promise<VideoReviewRow> {
  const inserted = await supabase.from("video_review_candidates").insert(insertPayload(candidate)).select("*").limit(1);
  if (inserted.error) {
    if (isMissingSupabaseRelation(inserted.error, "video_review_candidates")) {
      throw new Error("video review inbox is unavailable until its migration is applied");
    }
    if (isUniqueViolation(inserted.error)) {
      const existing = await supabase
        .from("video_review_candidates")
        .select("id")
        .eq("video_id", candidate.videoId)
        .limit(1);
      throwReadError("existing video candidate", existing.error);
      const id = (existing.data as { id: string }[] | null)?.[0]?.id;
      throw new DuplicateVideoReviewCandidate(id ?? "unknown");
    }
    throw new Error(`video candidate insert failed: ${inserted.error.message}`);
  }
  const row = (inserted.data as VideoReviewRow[] | null)?.[0];
  if (!row) throw new Error("video candidate insert returned no row");
  return row;
}

type CandidateMutation = { candidate: VideoReviewRow; draft: VideoPublicationDraftRow | null };

function draftPayload(candidate: NormalizedVideoReviewCandidate) {
  const draft = buildVideoPublicationDraft(candidate);
  return {
    video_id: candidate.videoId,
    completeness: draft.completeness,
    missing_requirements: draft.missingRequirements,
    markdown: draft.markdown,
  };
}

async function mutateCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
  operation: "save" | "approve" | "skip" | "archive" | "restore",
  candidate: Record<string, unknown> | null = null,
  draft: ReturnType<typeof draftPayload> | null = null,
): Promise<CandidateMutation> {
  const result = await supabase.rpc("mutate_video_review_candidate", {
    p_id: id, p_revision: revision, p_operation: operation,
    p_candidate: candidate, p_draft: draft,
  });
  if (result.error) {
    if (result.error.message === "stale_video_review_edit") throw new StaleVideoReviewEdit();
    if (isMissingSupabaseRpc(result.error, "mutate_video_review_candidate")) {
      throw new Error("video review inbox is unavailable until its migration is applied");
    }
    throw new Error(`video candidate ${operation} failed: ${result.error.message}`);
  }
  if (!result.data?.candidate) throw new Error("video candidate mutation returned no row");
  return result.data as CandidateMutation;
}

async function readCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
): Promise<VideoReviewRow> {
  const current = await supabase.from("video_review_candidates").select("*").eq("id", id).limit(1);
  throwReadError("video candidate", current.error);
  const row = (current.data as VideoReviewRow[] | null)?.[0];
  if (!row) throw new Error("video candidate not found");
  return row;
}

export async function updateVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
  candidate: NormalizedVideoReviewCandidate,
): Promise<VideoReviewRow> {
  const current = await readCandidate(supabase, id);
  if (current.state === "archived") throw new Error("Restore this archived draft before editing it.");
  if (current.revision !== revision) throw new StaleVideoReviewEdit();
  const sameIdentity = current.video_id === candidate.videoId &&
    current.source_id === candidate.sourceId && current.creator_channel_id === candidate.creatorChannelId;
  const patch = insertPayload(candidate);
  delete patch.state;
  const draft = current.state === "draft_ready" && sameIdentity ? draftPayload(candidate) : null;
  return (await mutateCandidate(supabase, id, revision, "save", patch, draft)).candidate;
}

async function existingApprovedDraft(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: VideoReviewRow,
): Promise<{ candidate: VideoReviewRow; draft: VideoPublicationDraftRow }> {
  const draft = await readPublicationDraft(supabase, candidate.id);
  if ("status" in draft) throw new Error("video review inbox is unavailable until its migration is applied");
  return { candidate, draft };
}

export async function skipVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
): Promise<VideoReviewRow> {
  const current = await readCandidate(supabase, id);
  if (current.state === "archived") throw new Error("This draft is archived. Restore it to resume review.");
  if (current.state === "skipped") return current;
  if (current.state === "draft_ready") {
    throw new Error("This video already has a publication draft. Skipping it now would hide a ready later-PR item.");
  }
  if (current.revision !== revision) throw new StaleVideoReviewEdit();
  try {
    return (await mutateCandidate(supabase, id, revision, "skip")).candidate;
  } catch (error) {
    if (!(error instanceof StaleVideoReviewEdit)) throw error;
    const latest = await readCandidate(supabase, id);
    if (latest.state === "skipped") return latest;
    throw error;
  }
}

export async function approveVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
): Promise<{ candidate: VideoReviewRow; draft: VideoPublicationDraftRow }> {
  const current = await readCandidate(supabase, id);
  if (current.state === "archived") throw new Error("This draft is archived. Restore it to resume review.");
  // An already completed approval is read-only, including a repeated stale click.
  if (current.state === "draft_ready") return existingApprovedDraft(supabase, current);
  if (current.revision !== revision) throw new StaleVideoReviewEdit();
  try {
    const result = await mutateCandidate(supabase, id, revision, "approve", null, draftPayload(rowToNormalized(current)));
    if (!result.draft) throw new Error("approval returned no publication draft");
    return { candidate: result.candidate, draft: result.draft };
  } catch (error) {
    if (!(error instanceof StaleVideoReviewEdit)) throw error;
    const latest = await readCandidate(supabase, id);
    if (latest.state === "draft_ready") return existingApprovedDraft(supabase, latest);
    throw error;
  }
}

export async function archiveVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
): Promise<VideoReviewRow> {
  const current = await readCandidate(supabase, id);
  if (current.state === "archived") return current;
  if (current.revision !== revision) throw new StaleVideoReviewEdit();
  if (current.state !== "draft_ready") throw new Error("Only a ready publication draft can be archived.");
  try {
    return (await mutateCandidate(supabase, id, revision, "archive")).candidate;
  } catch (error) {
    if (!(error instanceof StaleVideoReviewEdit)) throw error;
    const latest = await readCandidate(supabase, id);
    if (latest.state === "archived") return latest;
    throw error;
  }
}

export async function restoreVideoReviewCandidate(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  revision: number,
): Promise<VideoReviewRow> {
  const current = await readCandidate(supabase, id);
  if (current.revision !== revision) throw new StaleVideoReviewEdit();
  if (current.state !== "archived") throw new Error("Only an archived draft can be restored.");
  return (await mutateCandidate(supabase, id, revision, "restore")).candidate;
}

export async function readPublicationDraft(
  supabase: ReturnType<typeof createServiceClient>,
  candidateId: string,
): Promise<VideoPublicationDraftRow | { status: "unavailable"; reason: "schema_missing" }> {
  const result = await supabase.from("video_publication_drafts").select("*").eq("candidate_id", candidateId).limit(1);
  if (result.error) {
    if (isMissingSupabaseRelation(result.error, "video_publication_drafts")) {
      return { status: "unavailable", reason: "schema_missing" };
    }
    throw new Error(`publication draft read failed: ${result.error.message}`);
  }
  if (result.data === null) throw new Error("publication draft read returned no rows");
  const draft = (result.data as VideoPublicationDraftRow[])[0];
  if (!draft) throw new Error("publication draft not found");
  return draft;
}

export function isVideoReviewSchemaMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  return (
    isMissingSupabaseRelation(error, "video_review_candidates") ||
    isMissingSupabaseRelation(error, "video_publication_drafts") ||
    isMissingSupabaseRpc(error, "owner_attention_brief")
  );
}
