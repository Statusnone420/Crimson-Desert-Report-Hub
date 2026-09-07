"use client";

import { initialVideoActionState, type VideoActionState } from "@/lib/videoReviewActionState";

import { useActionState, useState, type FormEventHandler, type ReactNode } from "react";
import {
  addVideoReviewCandidateState,
  approveVideoCandidateState,
  archiveVideoCandidateState,
  restoreVideoCandidateState,
  saveVideoReviewCandidateState,
  skipVideoCandidateState,
} from "@/app/admin/videos/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ACTION_TRANSPORT_FAILURE_MESSAGE, isActionTransportFailure } from "@/lib/actionTransportFailure";

type VideoState = "pending" | "draft_ready" | "skipped" | "archived";

export type VideoCandidate = {
  id: string;
  createdAt: string;
  revision: number;
  canonicalUrl: string;
  submittedUrl: string;
  sourceId: string;
  title: string;
  channelLabel: string;
  reviewNote: string;
  reviewedHeadline: string | null;
  reviewedExcerpt: string | null;
  excerptReviewStatus: "reviewed" | "unreviewed";
  topic: "expansion" | "base_game";
  publishedAt: string | null;
  state: VideoState;
};

export type VideoDraft = {
  completeness: "complete" | "incomplete";
  missingRequirements: string[];
  markdown: string;
};

type Source = { id: string; label: string };

type CandidateFieldValues = {
  url: string;
  sourceId: string;
  title: string;
  channelLabel: string;
  topic: "expansion" | "base_game";
  publishedAt: string;
  reviewNote: string;
  reviewedHeadline: string;
  reviewedExcerpt: string;
  excerptReviewed: boolean;
};

type VideoWorkspaceProps = {
  candidates: VideoCandidate[];
  draftsByCandidateId: Record<string, VideoDraft>;
  sources: Source[];
  observedAt: string;
  initialSelectedId?: string;
  writesDisabled: boolean;
};

const stateLabels: Record<VideoState, string> = {
  pending: "Pending",
  draft_ready: "Draft ready",
  skipped: "Skipped",
  archived: "Archived",
};

function ageLabel(createdAt: string, observedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(observedAt) - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function candidateFieldValues(candidate: VideoCandidate | undefined, sources: Source[]): CandidateFieldValues {
  return {
    url: candidate?.submittedUrl ?? "",
    sourceId: candidate?.sourceId ?? sources[0]?.id ?? "",
    title: candidate?.title ?? "",
    channelLabel: candidate?.channelLabel ?? sources[0]?.label ?? "",
    topic: candidate?.topic ?? "expansion",
    publishedAt: candidate?.publishedAt ?? "",
    reviewNote: candidate?.reviewNote ?? "",
    reviewedHeadline: candidate?.reviewedHeadline ?? "",
    reviewedExcerpt: candidate?.reviewedExcerpt ?? "",
    excerptReviewed: candidate?.excerptReviewStatus === "reviewed",
  };
}

function CandidateFields({
  candidate,
  sources,
  values,
  onChange,
}: {
  candidate?: VideoCandidate;
  sources: Source[];
  values: CandidateFieldValues;
  onChange: (patch: Partial<CandidateFieldValues>) => void;
}) {
  const id = candidate?.id ?? "new";
  return (
    <div className="workspace-grid">
      <div className="workspace-field">
        <label htmlFor={`url-${id}`}>YouTube URL</label>
        <input id={`url-${id}`} name="url" required value={values.url} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://youtu.be/…" autoComplete="off" />
      </div>
      <div className="workspace-field">
        <label htmlFor={`source-${id}`}>Registered source</label>
        <select id={`source-${id}`} name="source_id" value={values.sourceId} onChange={(event) => onChange({ sourceId: event.target.value })} required>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
        </select>
      </div>
      <div className="workspace-field">
        <label htmlFor={`title-${id}`}>Title</label>
        <input id={`title-${id}`} name="title" required value={values.title} onChange={(event) => onChange({ title: event.target.value })} maxLength={240} />
      </div>
      <div className="workspace-field">
        <label htmlFor={`channel-${id}`}>Channel</label>
        <input id={`channel-${id}`} name="channel_label" required value={values.channelLabel} onChange={(event) => onChange({ channelLabel: event.target.value })} maxLength={120} />
      </div>
      <div className="workspace-field">
        <label htmlFor={`topic-${id}`}>Topic</label>
        <select id={`topic-${id}`} name="topic" value={values.topic} onChange={(event) => onChange({ topic: event.target.value as CandidateFieldValues["topic"] })}>
          <option value="expansion">Expansion</option>
          <option value="base_game">Base game</option>
        </select>
      </div>
      <div className="workspace-field">
        <label htmlFor={`published-${id}`}>Source date</label>
        <input id={`published-${id}`} name="published_at" value={values.publishedAt} onChange={(event) => onChange({ publishedAt: event.target.value })} placeholder="2026-09-03" />
      </div>
      <div className="workspace-field workspace-field--wide">
        <label htmlFor={`note-${id}`}>Review note</label>
        <textarea id={`note-${id}`} name="review_note" required value={values.reviewNote} onChange={(event) => onChange({ reviewNote: event.target.value })} maxLength={500} rows={3} />
      </div>
      <div className="workspace-field">
        <label htmlFor={`headline-${id}`}>Reviewed headline</label>
        <input id={`headline-${id}`} name="reviewed_headline" value={values.reviewedHeadline} onChange={(event) => onChange({ reviewedHeadline: event.target.value })} maxLength={240} />
      </div>
      <div className="workspace-field workspace-field--wide">
        <label htmlFor={`excerpt-${id}`}>Reviewed excerpt</label>
        <textarea id={`excerpt-${id}`} name="reviewed_excerpt" value={values.reviewedExcerpt} onChange={(event) => onChange({ reviewedExcerpt: event.target.value })} maxLength={500} rows={3} />
      </div>
      <label className="workspace-note">
        <input type="checkbox" name="excerpt_review_status" value="reviewed" checked={values.excerptReviewed} onChange={(event) => onChange({ excerptReviewed: event.target.checked })} /> Excerpt is reviewed
      </label>
    </div>
  );
}

function ActionFields({ candidate }: { candidate: VideoCandidate }) {
  return <><input type="hidden" name="id" value={candidate.id} /><input type="hidden" name="revision" value={candidate.revision} /></>;
}

type VideoStateAction = (previous: VideoActionState, formData: FormData) => Promise<VideoActionState>;

function VideoActionForm({
  action,
  children,
  className,
  onSubmit,
  writesDisabled,
}: {
  action: VideoStateAction;
  children: ReactNode;
  className?: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  writesDisabled: boolean;
}) {
  const [state, formAction] = useActionState<VideoActionState, FormData>(async (previous, formData) => {
    try {
      return await action(previous, formData);
    } catch (error) {
      if (isActionTransportFailure(error)) return { status: "transport_error", code: "transport", message: ACTION_TRANSPORT_FAILURE_MESSAGE };
      throw error;
    }
  }, initialVideoActionState);
  return <form action={formAction} className={className} onSubmit={onSubmit} onReset={(event) => event.preventDefault()}>
    <fieldset disabled={writesDisabled} className="workspace-fieldset">{children}</fieldset>
    {state.status !== "idle" ? <p className={state.status === "error" ? "workspace-error" : "workspace-note"} role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message}</p> : null}
  </form>;
}

export function VideoWorkspace({ candidates, draftsByCandidateId, sources, observedAt, initialSelectedId, writesDisabled }: VideoWorkspaceProps) {
  const active = candidates.filter((candidate) => candidate.state !== "archived");
  const archived = candidates.filter((candidate) => candidate.state === "archived");
  const initialCandidate = candidates.find((candidate) => candidate.id === initialSelectedId);
  const [tab, setTab] = useState<"active" | "archived">(initialCandidate?.state === "archived" ? "archived" : "active");
  const [selectedId, setSelectedId] = useState(() => initialCandidate?.id ?? active[0]?.id ?? archived[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, CandidateFieldValues>>({});
  const shown = tab === "active" ? active : archived;
  const selected = shown.find((candidate) => candidate.id === selectedId) ?? shown[0] ?? null;

  function fieldsFor(candidate?: VideoCandidate): CandidateFieldValues {
    const key = candidate?.id ?? "new";
    return drafts[key] ?? candidateFieldValues(candidate, sources);
  }

  function updateFields(candidate: VideoCandidate | undefined, patch: Partial<CandidateFieldValues>) {
    const key = candidate?.id ?? "new";
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? candidateFieldValues(candidate, sources)), ...patch } }));
  }

  function selectTab(next: "active" | "archived") {
    setTab(next);
    const current = candidates.find((candidate) => candidate.id === selectedId);
    if (!current || (next === "active" ? current.state === "archived" : current.state !== "archived")) {
      setSelectedId((next === "active" ? active : archived)[0]?.id ?? null);
    }
  }

  return (
    <div className="workspace-page video-workspace">
      <header className="workspace-heading">
        <div>
          <h1>Video review</h1>
          <p>Add a creator video by hand, review its evidence, and prepare a private later-PR checklist. Approval never publishes or changes Watch.</p>
        </div>
        <a className="workspace-button" href="/operator?view=videos">Open workspace link</a>
      </header>

      <section className="workspace-panel" aria-label="Video inbox summary">
        <div className="workspace-panel-body workspace-toolbar">
          <span className="workspace-badge workspace-badge--amber">{candidates.filter((candidate) => candidate.state === "pending").length} pending</span>
          <span className="workspace-badge workspace-badge--green">{candidates.filter((candidate) => candidate.state === "draft_ready").length} draft ready</span>
          <span className="workspace-note">Private queue · manual metadata · observed {new Date(observedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span>
        </div>
      </section>

      <section className="workspace-panel" aria-label="Add a video">
        <div className="workspace-panel-header"><h2>Add a video</h2><p>YouTube URLs only. No crawler or lookup runs from this form.</p></div>
        <VideoActionForm action={addVideoReviewCandidateState} className="workspace-panel-body" writesDisabled={writesDisabled}>
          <CandidateFields sources={sources} values={fieldsFor(undefined)} onChange={(patch) => updateFields(undefined, patch)} />
          <div className="workspace-actions"><SubmitButton className="workspace-button workspace-button--primary" pendingText="Adding…">Add to inbox</SubmitButton></div>
        </VideoActionForm>
      </section>

      <section className="workspace-panel" aria-label="Private video queue">
        <div className="workspace-panel-header workspace-toolbar">
          <div><h2>Queue</h2><p>Choose one item to edit. Decisions remain private until a later publication PR is merged.</p></div>
          <div className="workspace-tabs" role="tablist" aria-label="Video queue views">
            <button className="workspace-tab" type="button" role="tab" aria-selected={tab === "active"} onClick={() => selectTab("active")}>Active ({active.length})</button>
            <button className="workspace-tab" type="button" role="tab" aria-selected={tab === "archived"} onClick={() => selectTab("archived")}>Archived drafts ({archived.length})</button>
          </div>
        </div>
        <div className="workspace-panel-body workspace-split">
          <div className="workspace-queue" aria-label={tab === "active" ? "Active video candidates" : "Archived video candidates"}>
            {shown.length === 0 ? <p className="workspace-empty">{tab === "active" ? "No active video candidates. Add a YouTube link above or restore an archived draft." : "No archived publication drafts."}</p> : shown.map((candidate) => (
              <article key={candidate.id} data-video-state={candidate.state} className={`workspace-queue-item${selected?.id === candidate.id ? " is-selected" : ""}`}>
                <button type="button" className="workspace-queue-item__select" onClick={() => setSelectedId(candidate.id)} aria-current={selected?.id === candidate.id ? "true" : undefined}>
                  <span className={candidate.state === "draft_ready" ? "workspace-badge workspace-badge--green" : "workspace-badge workspace-badge--amber"}>{stateLabels[candidate.state]}</span>
                  <strong role="heading" aria-level={3}>{candidate.title}</strong>
                  <span>{candidate.channelLabel} · {ageLabel(candidate.createdAt, observedAt)}</span>
                </button>
                <div className="workspace-actions">
                  {candidate.state !== "archived" && candidate.state !== "draft_ready" ? <VideoActionForm action={approveVideoCandidateState} onSubmit={() => setSelectedId(candidate.id)} writesDisabled={writesDisabled}><ActionFields candidate={candidate} /><SubmitButton className="workspace-button workspace-button--primary" pendingText="Preparing…">Approve draft</SubmitButton></VideoActionForm> : null}
                  {candidate.state !== "archived" && candidate.state !== "draft_ready" ? <VideoActionForm action={skipVideoCandidateState} onSubmit={() => setSelectedId(candidate.id)} writesDisabled={writesDisabled}><ActionFields candidate={candidate} /><SubmitButton className="workspace-button workspace-button--danger" pendingText="Skipping…">Skip</SubmitButton></VideoActionForm> : null}
                  {candidate.state === "draft_ready" ? <VideoActionForm action={approveVideoCandidateState} onSubmit={() => setSelectedId(candidate.id)} writesDisabled={writesDisabled}><ActionFields candidate={candidate} /><SubmitButton className="workspace-button" pendingText="Checking…">Approve draft</SubmitButton></VideoActionForm> : null}
                  {candidate.state === "draft_ready" ? <VideoActionForm action={archiveVideoCandidateState} onSubmit={() => setSelectedId(candidate.id)} writesDisabled={writesDisabled}><ActionFields candidate={candidate} /><SubmitButton className="workspace-button" pendingText="Archiving…">Archive draft</SubmitButton></VideoActionForm> : null}
                  {candidate.state === "archived" ? <VideoActionForm action={restoreVideoCandidateState} onSubmit={() => { setSelectedId(candidate.id); setTab("active"); }} writesDisabled={writesDisabled}><ActionFields candidate={candidate} /><SubmitButton className="workspace-button" pendingText="Restoring…">Restore draft</SubmitButton></VideoActionForm> : null}
                </div>
              </article>
            ))}
          </div>
          {selected ? <VideoDetail candidate={selected} draft={draftsByCandidateId[selected.id]} sources={sources} values={fieldsFor(selected)} onChange={(patch) => updateFields(selected, patch)} writesDisabled={writesDisabled} /> : <section className="workspace-panel workspace-empty"><h2>No video selected</h2><p>Choose a queue item to inspect its private review details.</p></section>}
        </div>
      </section>
    </div>
  );
}

function VideoDetail({
  candidate,
  draft,
  sources,
  values,
  onChange,
  writesDisabled,
}: {
  candidate: VideoCandidate;
  draft?: VideoDraft;
  sources: Source[];
  values: CandidateFieldValues;
  onChange: (patch: Partial<CandidateFieldValues>) => void;
  writesDisabled: boolean;
}) {
  const isArchived = candidate.state === "archived";
  return (
    <section className="workspace-panel-body workspace-detail" aria-label={`Video details: ${candidate.title}`}>
      <div className="workspace-toolbar">
        <div><h2>{candidate.title}</h2><p><a href={candidate.canonicalUrl} target="_blank" rel="noreferrer noopener">Open the original YouTube video</a></p></div>
        <span className={candidate.state === "draft_ready" ? "workspace-badge workspace-badge--green" : "workspace-badge workspace-badge--amber"}>{stateLabels[candidate.state]}</span>
      </div>
      {!isArchived ? <VideoActionForm action={saveVideoReviewCandidateState} writesDisabled={writesDisabled}>
        <ActionFields candidate={candidate} />
        <CandidateFields candidate={candidate} sources={sources} values={values} onChange={onChange} />
        <div className="workspace-actions"><SubmitButton className="workspace-button workspace-button--primary" pendingText="Saving…">Save</SubmitButton></div>
        {candidate.state === "draft_ready" ? <p className="workspace-note">Changing the video or creator removes this private draft and requires a new approval.</p> : null}
      </VideoActionForm> : <p className="workspace-note">Archived drafts are read-only. Restore this draft to resume review.</p>}
      {draft ? <section className="workspace-panel" aria-label="Publication draft preview">
        <div className="workspace-panel-header"><h3>{draft.completeness === "complete" ? "Draft complete" : "Draft incomplete"}</h3><p>This is a private checklist for a later PR. It does not publish a video or update Watch.</p></div>
        <div className="workspace-panel-body">
          {draft.missingRequirements.length > 0 ? <ul className="workspace-note">{draft.missingRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : null}
          <pre className="video-draft-preview">{draft.markdown}</pre>
          <a className="workspace-button" href={`/api/admin/videos/${candidate.id}/draft`}>Download draft</a>
        </div>
      </section> : null}
    </section>
  );
}
