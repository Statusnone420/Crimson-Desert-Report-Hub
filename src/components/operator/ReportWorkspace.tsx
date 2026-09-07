"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { externalWebHref } from "@/lib/externalWebHref";
import { reviewReport, retryApprovedExcerpt } from "@/app/admin/report-actions";
import {
  INITIAL_REPORT_REVIEW_STATE,
  type ReportReviewActionState,
} from "@/lib/reportReviewAction";
import type { FlaggedReport, ReportReviewQueue } from "@/lib/reportReview";
import type { AdminClusterRow } from "@/lib/adminClusters";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { ACTION_TRANSPORT_FAILURE_MESSAGE, isActionTransportFailure } from "@/lib/actionTransportFailure";

function ageLabel(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function ReportEditor({
  report,
  clusters,
  disabled,
  onSaved,
  onRetain,
}: {
  report: FlaggedReport;
  clusters: AdminClusterRow[];
  disabled: boolean;
  onSaved: (id: string, message: string) => void;
  onRetain: (id: string, retain: boolean) => void;
}) {
  const router = useRouter();
  const evidenceHref = externalWebHref(report.evidence_url);
  const [excerpt, setExcerpt] = useState("");
  const [clusterId, setClusterId] = useState(report.cluster_id ?? "");
  const [actionState, action, pending] = useActionState<ReportReviewActionState, FormData>(
    async (previous, formData) => {
      onRetain(report.id, true);
      let result: ReportReviewActionState;
      try {
        result = previous.status === "approved_excerpt_pending"
          ? await retryApprovedExcerpt(previous, formData)
          : await reviewReport(previous, formData);
      } catch (error) {
        if (isActionTransportFailure(error)) {
          return { status: previous.status === "approved_excerpt_pending" ? "approved_excerpt_pending" : "transport_error", message: ACTION_TRANSPORT_FAILURE_MESSAGE, reportId: report.id };
        }
        throw error;
      }
      if (result.status === "saved") {
        onRetain(report.id, false);
        onSaved(report.id, result.message ?? "Report decision saved.");
      } else if (result.status !== "approved_excerpt_pending" && result.status !== "transport_error")
        onRetain(report.id, false);
      return result;
    },
    INITIAL_REPORT_REVIEW_STATE,
  );
  const partial = actionState.status === "approved_excerpt_pending";
  return (
    <section
      className="workspace-panel workspace-detail"
      aria-labelledby={`report-heading-${report.id}`}
    >
      <header className="workspace-detail-heading">
        <span className="workspace-badge workspace-badge--blue">
          {PLATFORM_LABELS[report.platform as keyof typeof PLATFORM_LABELS] ??
            report.platform}
        </span>
        <h2 id={`report-heading-${report.id}`} tabIndex={-1}>
          {report.issue_title}
        </h2>
        <p>
          {ageLabel(report.created_at)} Eastern · Patch {report.patch_version} ·{" "}
          {report.severity}
        </p>
      </header>
      <form action={action} onReset={(event) => event.preventDefault()}>
        <input type="hidden" name="id" value={report.id} />
        <div className="workspace-panel-body">
          {actionState.message && (
            <div
              className={
                actionState.status === "saved"
                  ? "workspace-notice"
                  : "workspace-error"
              }
              role="status"
            >
              {actionState.message}
              {actionState.status === "stale" && (
                <button
                  type="button"
                  className="workspace-button"
                  onClick={() => router.refresh()}
                >
                  Reload current queue
                </button>
              )}
            </div>
          )}
          <div className="workspace-detail-section">
            <h3>Player description</h3>
            <p>{report.description}</p>
          </div>
          {report.repro_steps && (
            <div className="workspace-detail-section">
              <h3>Steps to reproduce</h3>
              <p>{report.repro_steps}</p>
            </div>
          )}
          {report.hardware_specs && (
            <div className="workspace-detail-section">
              <h3>Hardware</h3>
              <p>{report.hardware_specs}</p>
            </div>
          )}
          {report.evidence_url && (
            <div className="workspace-detail-section">
              <h3>Private evidence</h3>
              <a
                className="workspace-text-link"
                href={evidenceHref}
                target="_blank"
                rel="noreferrer"
              >
                {evidenceHref
                  ? "Open submitted evidence"
                  : "Submitted evidence URL is not a valid web link."}
              </a>
            </div>
          )}
          <div className="workspace-detail-section workspace-form">
            <label className="workspace-field">
              Issue assignment
              <select
                name="cluster_id"
                value={clusterId}
                onChange={(e) => setClusterId(e.target.value)}
                disabled={pending || partial || disabled}
              >
                <option value="">Unassigned</option>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="workspace-field">
              Public excerpt
              <textarea
                name="excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                maxLength={500}
                disabled={pending || disabled}
                required={partial}
                placeholder="Optional. Keep the wording anonymous and factual."
              />
            </label>
            <p className="workspace-note">
              The full report remains private. Only an approved excerpt can
              appear publicly. Category:{" "}
              {CATEGORY_LABELS[
                report.category as keyof typeof CATEGORY_LABELS
              ] ?? report.category}
              ; frequency: {report.frequency}.
            </p>
          </div>
        </div>
        <div className="workspace-actions">
          {partial ? (
            <button
              className="workspace-button workspace-button--primary"
              disabled={pending || disabled}
            >
              {pending ? "Saving excerpt…" : "Retry excerpt only"}
            </button>
          ) : (
            <>
              <button
                className="workspace-button workspace-button--primary"
                name="decision"
                value="approved"
                disabled={pending || disabled}
              >
                {pending ? "Saving…" : "Approve"}
              </button>
              <button
                className="workspace-button workspace-button--danger"
                name="decision"
                value="rejected"
                disabled={pending || disabled}
              >
                Reject
              </button>
              <button
                className="workspace-button workspace-button--danger"
                name="decision"
                value="spam"
                disabled={pending || disabled}
              >
                Spam
              </button>
            </>
          )}
          <p className="workspace-note">
            Approve records player evidence and can make the assigned issue
            visible. The optional excerpt is saved separately; an excerpt
            failure does not undo approval.
          </p>
        </div>
      </form>
    </section>
  );
}

export function ReportWorkspace({
  queue,
  clusters,
  disabled,
  initialId,
}: {
  queue: ReportReviewQueue;
  clusters: AdminClusterRow[];
  disabled: boolean;
  initialId?: string;
}) {
  // Keep mounted editors after a server refresh so a partial save never discards a private draft.
  const [retained] = useState(queue.flaggedReports);
  const [retainedIds, setRetainedIds] = useState<string[]>([]);
  const rows = [
    ...queue.flaggedReports,
    ...retained.filter(
      (r) =>
        retainedIds.includes(r.id) &&
        !queue.flaggedReports.some((current) => current.id === r.id),
    ),
  ];
  const retainEditor = (id: string, keep: boolean) =>
    setRetainedIds((prior) =>
      keep
        ? [...new Set([...prior, id])]
        : prior.filter((value) => value !== id),
    );
  const [selected, setSelected] = useState(initialId ?? rows[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const visible = rows.filter(
    (r) =>
      !done.includes(r.id) &&
      r.issue_title.toLowerCase().includes(search.toLowerCase()),
  );
  const active = visible.find((r) => r.id === selected) ?? visible[0];
  const saveComplete = (id: string, message: string) => {
    setNotice(message);
    setDone((prior) => [...prior, id]);
    heading.current?.focus();
  };
  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Reports
          </h1>
          <p>
            Read the report, choose its issue, and decide what belongs on the
            board.
          </p>
        </div>
        <span className="workspace-count">
          {queue.pendingCount} pending · {queue.approvedCount} approved ·{" "}
          {queue.spamCount} spam
        </span>
      </header>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <div className="workspace-toolbar">
        <p className="workspace-note">
          Oldest first · showing up to {queue.flaggedReports.length} of{" "}
          {queue.pendingCount} pending reports
        </p>
        <label>
          <span className="sr-only">Search reports</span>
          <input
            className="workspace-search"
            type="search"
            placeholder="Search this queue"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="workspace-split">
        <section className="workspace-panel workspace-review-list">
          <header className="workspace-panel-header">
            <h2>Waiting for review</h2>
            <span className="workspace-count">{visible.length}</span>
          </header>
          <div className="workspace-queue">
            {visible.map((r) => (
              <button
                type="button"
                key={r.id}
                className="workspace-queue-item"
                aria-current={active?.id === r.id ? "true" : undefined}
                onClick={() => {
                  setSelected(r.id);
                  requestAnimationFrame(() =>
                    document.getElementById(`report-heading-${r.id}`)?.focus(),
                  );
                }}
              >
                <span className="workspace-badge workspace-badge--blue">
                  {PLATFORM_LABELS[
                    r.platform as keyof typeof PLATFORM_LABELS
                  ] ?? r.platform}
                </span>
                <strong>{r.issue_title}</strong>
                <small>{ageLabel(r.created_at)} Eastern</small>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="workspace-empty">
                <h3>
                  {queue.pendingCount === 0
                    ? "No flagged reports"
                    : "No matching reports"}
                </h3>
                <p>
                  {queue.pendingCount === 0
                    ? "No reports need moderation."
                    : "Clear the search or refresh to load the next reports."}
                </p>
              </div>
            )}
          </div>
        </section>
        <div>
          {rows
            .filter((r) => !done.includes(r.id))
            .map((r) => (
              <div key={r.id} hidden={active?.id !== r.id}>
                <ReportEditor
                  report={r}
                  clusters={clusters}
                  disabled={disabled}
                  onSaved={saveComplete}
                  onRetain={retainEditor}
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
