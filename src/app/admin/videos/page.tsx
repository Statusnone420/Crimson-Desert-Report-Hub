import {
  addVideoReviewCandidate,
  approveVideoCandidate,
  saveVideoReviewCandidate,
  skipVideoCandidate,
} from "@/app/admin/videos/actions";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/adminGuard";
import { formatAge } from "@/lib/ownerAttentionBrief";
import { createServiceClient } from "@/lib/supabase";
import { creatorEditorialSources } from "@/lib/videoReview";
import { readVideoReviewQueue, type VideoPublicationDraftRow, type VideoReviewRow } from "@/lib/videoReviewStore";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Video review",
  robots: { index: false, follow: false },
};

const STATE_LABEL: Record<VideoReviewRow["state"], string> = {
  pending: "Pending",
  draft_ready: "Draft ready",
  skipped: "Skipped",
};

function CandidateFields({
  row,
  sources,
}: {
  row?: VideoReviewRow;
  sources: ReturnType<typeof creatorEditorialSources>;
}) {
  const defaultSource = row?.source_id ?? sources[0]?.id ?? "";
  return (
    <>
      <label className="field-label" htmlFor={row ? `url-${row.id}` : "url"}>
        YouTube URL
      </label>
      <input
        id={row ? `url-${row.id}` : "url"}
        name="url"
        required
        defaultValue={row?.submitted_url ?? row?.canonical_url ?? ""}
        placeholder="https://youtu.be/… or https://www.youtube.com/watch?v=…"
        autoComplete="off"
      />
      <label className="field-label" htmlFor={row ? `source-${row.id}` : "source_id"}>
        Registered source
      </label>
      <select id={row ? `source-${row.id}` : "source_id"} name="source_id" defaultValue={defaultSource} required>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.label}
          </option>
        ))}
      </select>
      <label className="field-label" htmlFor={row ? `title-${row.id}` : "title"}>
        Title
      </label>
      <input id={row ? `title-${row.id}` : "title"} name="title" required defaultValue={row?.title ?? ""} maxLength={240} />
      <label className="field-label" htmlFor={row ? `channel-${row.id}` : "channel_label"}>
        Channel
      </label>
      <input
        id={row ? `channel-${row.id}` : "channel_label"}
        name="channel_label"
        required
        defaultValue={row?.channel_label ?? sources[0]?.label ?? ""}
        maxLength={120}
      />
      <label className="field-label" htmlFor={row ? `note-${row.id}` : "review_note"}>
        Review note
      </label>
      <textarea
        id={row ? `note-${row.id}` : "review_note"}
        name="review_note"
        required
        defaultValue={row?.review_note ?? ""}
        maxLength={500}
        rows={3}
      />
      <label className="field-label" htmlFor={row ? `headline-${row.id}` : "reviewed_headline"}>
        Reviewed headline
      </label>
      <input
        id={row ? `headline-${row.id}` : "reviewed_headline"}
        name="reviewed_headline"
        defaultValue={row?.reviewed_headline ?? ""}
        maxLength={240}
      />
      <label className="field-label" htmlFor={row ? `excerpt-${row.id}` : "reviewed_excerpt"}>
        Reviewed excerpt
      </label>
      <textarea
        id={row ? `excerpt-${row.id}` : "reviewed_excerpt"}
        name="reviewed_excerpt"
        defaultValue={row?.reviewed_excerpt ?? ""}
        maxLength={500}
        rows={3}
      />
      <label className="field-label">
        <input
          type="checkbox"
          name="excerpt_review_status"
          value="reviewed"
          defaultChecked={row?.excerpt_review_status === "reviewed"}
        />{" "}
        Excerpt is reviewed
      </label>
      <label className="field-label" htmlFor={row ? `topic-${row.id}` : "topic"}>
        Topic
      </label>
      <select id={row ? `topic-${row.id}` : "topic"} name="topic" defaultValue={row?.topic ?? "expansion"}>
        <option value="expansion">Expansion</option>
        <option value="base_game">Base game</option>
      </select>
      <label className="field-label" htmlFor={row ? `published-${row.id}` : "published_at"}>
        Source date
      </label>
      <input
        id={row ? `published-${row.id}` : "published_at"}
        name="published_at"
        defaultValue={row?.published_at ?? ""}
        placeholder="2026-09-03 or 2026-09-03T18:35:11Z"
      />
      <input type="hidden" name="creator_channel_id" value={row?.creator_channel_id ?? sources[0]?.verifiedChannelId ?? ""} />
    </>
  );
}

function CandidateCard({
  row,
  draft,
  sources,
  nowMs,
}: {
  row: VideoReviewRow;
  draft: VideoPublicationDraftRow | undefined;
  sources: ReturnType<typeof creatorEditorialSources>;
  nowMs: number;
}) {
  const age = formatAge(Math.max(0, Math.floor((nowMs - Date.parse(row.created_at)) / 1000)));
  return (
    <article className="review-item review-item--raised" data-video-state={row.state}>
      <div className="review-item__meta">
        {STATE_LABEL[row.state]} · {row.channel_label} · {age} ago
      </div>
      <h2 className="review-item__title">{row.title}</h2>
      <p className="review-item__body">{row.review_note}</p>
      <p className="review-item__detail">
        <a href={row.canonical_url} target="_blank" rel="noreferrer noopener" className="dispatch-link break-all">
          {row.canonical_url}
        </a>
      </p>
      <form action={saveVideoReviewCandidate} className="review-item__form dispatch-field">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="revision" value={row.revision} />
        <CandidateFields row={row} sources={sources} />
        <SubmitButton className="dispatch-btn" pendingText="Saving...">
          Save
        </SubmitButton>
      </form>
      <div className="review-item__form" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <form action={approveVideoCandidate}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="revision" value={row.revision} />
          <SubmitButton className="dispatch-btn" pendingText="Preparing draft..." describedBy={`approve-scope-${row.id}`}>
            Approve draft
          </SubmitButton>
        </form>
        <form action={skipVideoCandidate}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="revision" value={row.revision} />
          <SubmitButton
            className="tap-btn tap-btn--destructive"
            pendingText="Skipping..."
            describedBy={`skip-scope-${row.id}`}
          >
            Skip
          </SubmitButton>
        </form>
      </div>
      <p className="scope-line" id={`approve-scope-${row.id}`}>
        <b>Approve draft</b> stores a private later-PR checklist. It does not publish this video, change Watch, or
        update a public registry.
      </p>
      <p className="scope-line" id={`skip-scope-${row.id}`}>
        <b>Skip</b> keeps this candidate private. It never appears on Watch.
      </p>
      {row.state === "draft_ready" && draft ? (
        <section aria-label="Publication draft preview" className="ledger-body">
          <p className="mono-label">{draft.completeness === "complete" ? "Draft complete" : "Draft incomplete"}</p>
          {draft.missing_requirements.length > 0 ? (
            <ul className="op-note">
              {draft.missing_requirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <pre className="video-draft-preview">{draft.markdown}</pre>
          <a className="op-link" href={`/api/admin/videos/${row.id}/draft`}>
            Download draft
          </a>
        </section>
      ) : null}
    </article>
  );
}

export default async function VideoReviewPage() {
  await requireAdmin("/admin/videos");
  const queue = await readVideoReviewQueue(createServiceClient());
  const sources = creatorEditorialSources();
  const nowMs = Date.now();

  if (queue.status === "unavailable") {
    return (
      <OperatorShell active="videos">
        <div className="dispatch-container">
          <header className="dispatch-pagehead">
            <div className="dispatch-pagehead__copy">
              <p className="dispatch-kicker dispatch-kicker--amber">Operator · Watch inbox</p>
              <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
                Video review
              </h1>
            </div>
          </header>
          <p className="op-unavailable" role="status">
            The private video inbox is unavailable because its database schema is not applied yet. This is not an empty
            queue.
          </p>
        </div>
      </OperatorShell>
    );
  }

  const pending = queue.candidates.filter((row) => row.state === "pending").length;
  const draftReady = queue.candidates.filter((row) => row.state === "draft_ready").length;
  const skipped = queue.candidates.filter((row) => row.state === "skipped").length;

  return (
    <OperatorShell active="videos">
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 32 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker dispatch-kicker--amber">Operator · Watch inbox</p>
            <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
              Video review
            </h1>
            <p className="dispatch-pagehead__dek" style={{ maxWidth: "56ch" }}>
              Add a YouTube link by hand. Approval prepares a later publication PR. Watch stays unchanged until you
              merge that later PR.
            </p>
          </div>
          <div className="dispatch-pagehead__status">PRIVATE QUEUE · MANUAL ONLY</div>
        </header>

        <div className="stat-band" aria-label="Inbox summary">
          <div className="stat-band__cell">
            <div className="stat-band__label">Pending</div>
            <div className={pending > 0 ? "stat-band__value stat-band__value--amber" : "stat-band__value"}>{pending}</div>
            <div className="stat-band__caption">Waiting for a decision</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Draft ready</div>
            <div className="stat-band__value">{draftReady}</div>
            <div className="stat-band__caption">Later PR checklist</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Skipped</div>
            <div className="stat-band__value">{skipped}</div>
            <div className="stat-band__caption">Kept private</div>
          </div>
        </div>

        <section className="review-band" aria-label="Add a video">
          <div className="section-head">
            <span className="mono-label">Add a video</span>
            <p className="op-note">YouTube URLs only. Metadata is entered by hand. No crawling or paid lookup.</p>
          </div>
          <form action={addVideoReviewCandidate} className="dispatch-field">
            <CandidateFields sources={sources} />
            <SubmitButton className="dispatch-btn" pendingText="Adding...">
              Add to inbox
            </SubmitButton>
          </form>
        </section>

        <section className="review-band" aria-label="Private video queue">
          <div className="section-head">
            <span className="mono-label">Queue</span>
            <p className="op-note">Oldest first. Repeated approve or skip does not create a second row.</p>
          </div>
          {queue.candidates.length === 0 ? (
            <p className="review-clear">No private video candidates yet. Add a YouTube link above.</p>
          ) : (
            queue.candidates.map((row) => (
              <CandidateCard
                key={row.id}
                row={row}
                draft={queue.draftsByCandidateId[row.id]}
                sources={sources}
                nowMs={nowMs}
              />
            ))
          )}
        </section>
      </div>
    </OperatorShell>
  );
}
