import { OperatorShell } from "@/components/dispatch/Chrome";
import { VideoWorkspace, type VideoCandidate, type VideoDraft } from "@/components/operator/VideoWorkspace";
import { requireAdmin } from "@/lib/adminGuard";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";
import { creatorEditorialSources } from "@/lib/videoReview";
import { readVideoReviewQueue } from "@/lib/videoReviewStore";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Video review",
  robots: { index: false, follow: false },
};

export default async function VideoReviewPage({ searchParams }: { searchParams?: Promise<{ item?: string | string[] }> } = {}) {
  await requireAdmin("/admin/videos");
  const params = await searchParams;
  const queue = await readVideoReviewQueue(createServiceClient());

  if (queue.status === "unavailable") {
    return (
      <OperatorShell active="videos">
        <div className="workspace-page">
          <header className="workspace-heading"><div><h1>Video review</h1><p>The private video inbox could not be opened.</p></div></header>
          <p className="workspace-error" role="status">The private video inbox is unavailable because its database schema is not applied yet. This is not an empty queue.</p>
        </div>
      </OperatorShell>
    );
  }

  const candidates: VideoCandidate[] = queue.candidates.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    revision: row.revision,
    canonicalUrl: row.canonical_url,
    submittedUrl: row.submitted_url,
    sourceId: row.source_id,
    title: row.title,
    channelLabel: row.channel_label,
    reviewNote: row.review_note,
    reviewedHeadline: row.reviewed_headline,
    reviewedExcerpt: row.reviewed_excerpt,
    excerptReviewStatus: row.excerpt_review_status,
    topic: row.topic,
    publishedAt: row.published_at,
    state: row.state,
  }));
  const draftsByCandidateId: Record<string, VideoDraft> = Object.fromEntries(
    Object.entries(queue.draftsByCandidateId).map(([candidateId, draft]) => [candidateId, {
      completeness: draft.completeness,
      missingRequirements: draft.missing_requirements,
      markdown: draft.markdown,
    }]),
  );
  const requestedItem = typeof params?.item === "string" ? params.item : undefined;
  const initialSelectedId = requestedItem && candidates.some((candidate) => candidate.id === requestedItem)
    ? requestedItem
    : undefined;

  return (
    <OperatorShell active="videos">
      <VideoWorkspace
        candidates={candidates}
        draftsByCandidateId={draftsByCandidateId}
        sources={creatorEditorialSources().map((source) => ({ id: source.id, label: source.label }))}
        observedAt={queue.observedAt}
        initialSelectedId={initialSelectedId}
        writesDisabled={isVercelPreview()}
      />
    </OperatorShell>
  );
}
