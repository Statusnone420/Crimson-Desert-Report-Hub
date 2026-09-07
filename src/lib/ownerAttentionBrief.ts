import "server-only";

import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import type { createServiceClient } from "@/lib/supabase";
import { isVideoReviewSchemaMissing } from "@/lib/videoReviewStore";

export const OWNER_ATTENTION_BRIEF_QUERY = "select public.owner_attention_brief();";

export type OwnerAttentionStatus = "ok" | "unavailable" | "error";

export type OwnerAttentionVideoItem = {
  title: string;
  channel: string;
  state: "pending" | "draft_ready";
  ageSeconds: number;
  reviewReason: string;
  adminPath: "/admin/videos";
};

export type OwnerAttentionBrief = {
  observedAt: string;
  status: OwnerAttentionStatus;
  unavailableReason?: "schema_missing" | "access_denied" | "read_failed";
  errorMessage?: string;
  videoInbox: {
    awaitingReview: { count: number; oldestAgeSeconds: number | null };
    draftsReady: { count: number; oldestAgeSeconds: number | null };
    items: OwnerAttentionVideoItem[];
  } | null;
  adminAttention: {
    flaggedPendingReports: number;
    unsureClaimMatches: number;
    needsYou: number;
    reportQueuePath: "/admin";
    scannerQueuePath: "/scanner";
  } | null;
};

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, no-cache, must-revalidate",
  pragma: "no-cache",
  "x-robots-tag": "noindex, nofollow",
} as const;

export function ownerAttentionPrivateHeaders(): Record<string, string> {
  return { ...PRIVATE_HEADERS };
}

function emptyUnavailable(
  reason: NonNullable<OwnerAttentionBrief["unavailableReason"]>,
  observedAt: string,
): OwnerAttentionBrief {
  return {
    observedAt,
    status: "unavailable",
    unavailableReason: reason,
    videoInbox: null,
    adminAttention: null,
  };
}

function isAccessDenied(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return error?.code === "42501" || /permission denied|not granted/i.test(text);
}

export function parseOwnerAttentionBrief(value: unknown, observedAt = new Date().toISOString()): OwnerAttentionBrief {
  if (!value || typeof value !== "object") {
    return {
      observedAt,
      status: "error",
      errorMessage: "brief returned no object",
      videoInbox: null,
      adminAttention: null,
    };
  }
  const record = value as Record<string, unknown>;
  if (record.status !== "ok") {
    return {
      observedAt: typeof record.observedAt === "string" ? record.observedAt : observedAt,
      status: "error",
      errorMessage: "brief status was not ok",
      videoInbox: null,
      adminAttention: null,
    };
  }
  const videoInbox = record.videoInbox;
  const adminAttention = record.adminAttention;
  if (!videoInbox || !adminAttention) {
    return {
      observedAt: typeof record.observedAt === "string" ? record.observedAt : observedAt,
      status: "error",
      errorMessage: "brief payload was incomplete",
      videoInbox: null,
      adminAttention: null,
    };
  }
  return value as OwnerAttentionBrief;
}

/**
 * Read-only summary for the existing 10 AM health check. Missing schema or
 * access is unavailable, never a fabricated empty queue.
 */
export async function readOwnerAttentionBrief(
  supabase: ReturnType<typeof createServiceClient>,
  now = new Date(),
): Promise<OwnerAttentionBrief> {
  const observedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const rpc = await supabase.rpc("owner_attention_brief");
  if (!rpc.error) {
    if (rpc.data == null) {
      return {
        observedAt,
        status: "error",
        errorMessage: "brief returned no payload",
        videoInbox: null,
        adminAttention: null,
      };
    }
    return parseOwnerAttentionBrief(rpc.data, observedAt);
  }
  if (isMissingSupabaseRpc(rpc.error, "owner_attention_brief") || isVideoReviewSchemaMissing(rpc.error)) {
    return emptyUnavailable("schema_missing", observedAt);
  }
  if (isAccessDenied(rpc.error)) return emptyUnavailable("access_denied", observedAt);
  return {
    observedAt,
    status: "error",
    errorMessage: "brief read failed",
    videoInbox: null,
    adminAttention: null,
  };
}

export type OwnerBriefBullet = {
  section: "needs_approval" | "keep_an_eye_on";
  decision: string;
  reason: string;
  nextStep: string;
};

/** At most five bullets. Quiet when there is nothing to do and the read succeeded. */
export function ownerBriefBullets(brief: OwnerAttentionBrief): OwnerBriefBullet[] {
  const bullets: OwnerBriefBullet[] = [];
  if (brief.status === "unavailable") {
    bullets.push({
      section: "keep_an_eye_on",
      decision: "Video inbox summary unavailable",
      reason:
        brief.unavailableReason === "access_denied"
          ? "Database access was denied."
          : "The private video-review schema is not applied yet.",
      nextStep: "Apply the video-review migration on the hosted project, then rerun select public.owner_attention_brief();",
    });
    return bullets.slice(0, 5);
  }
  if (brief.status === "error") {
    bullets.push({
      section: "keep_an_eye_on",
      decision: "Video inbox summary failed",
      reason: "The read-only brief returned an error, not an empty queue.",
      nextStep: "Inspect the Supabase error and retry the connector query. Do not treat this as zero work.",
    });
    return bullets.slice(0, 5);
  }
  if (brief.videoInbox && brief.videoInbox.awaitingReview.count > 0) {
    bullets.push({
      section: "needs_approval",
      decision: `${brief.videoInbox.awaitingReview.count} video ${brief.videoInbox.awaitingReview.count === 1 ? "candidate" : "candidates"} waiting`,
      reason: `Oldest ${formatAge(brief.videoInbox.awaitingReview.oldestAgeSeconds)}.`,
      nextStep: "Open /admin/videos and approve a later-PR draft or skip. Do not publish from this brief.",
    });
  }
  if (brief.videoInbox && brief.videoInbox.draftsReady.count > 0) {
    bullets.push({
      section: "needs_approval",
      decision: `${brief.videoInbox.draftsReady.count} publication ${brief.videoInbox.draftsReady.count === 1 ? "draft" : "drafts"} ready`,
      reason: `Oldest ${formatAge(brief.videoInbox.draftsReady.oldestAgeSeconds)}.`,
      nextStep: "Open /admin/videos, download the draft, and start a later publication PR when you choose.",
    });
  }
  if (brief.adminAttention && brief.adminAttention.flaggedPendingReports > 0) {
    bullets.push({
      section: "needs_approval",
      decision: `${brief.adminAttention.flaggedPendingReports} flagged ${brief.adminAttention.flaggedPendingReports === 1 ? "report" : "reports"}`,
      reason: "Needs you: pending reports still waiting for a call.",
      nextStep: "Open /admin. Completed maintainer decisions are not new work.",
    });
  }
  if (brief.adminAttention && brief.adminAttention.unsureClaimMatches > 0) {
    bullets.push({
      section: "needs_approval",
      decision: `${brief.adminAttention.unsureClaimMatches} unsure claim ${brief.adminAttention.unsureClaimMatches === 1 ? "match" : "matches"}`,
      reason: "Needs you: engine-owned unsure claim matches only.",
      nextStep: "Open /admin. Ordinary reports and locks you already set are not new approval work.",
    });
  }
  return bullets.slice(0, 5);
}

export function formatAge(seconds: number | null): string {
  if (seconds == null) return "unknown age";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
