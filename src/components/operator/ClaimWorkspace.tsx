"use client";

import { useActionState, useRef, useState } from "react";
import { externalWebHref } from "@/lib/externalWebHref";
import {
  confirmClaimReview,
  rejectClaimReview,
  laterClaimReview,
  undoClaimReview,
} from "@/app/admin/claim-actions";
import {
  initialClaimReviewActionState,
  type ClaimReviewActionState,
} from "@/lib/claimReviewActionState";
import type {
  ClaimReviewItem,
  ClaimReviewQueue,
  ClaimReviewAuditEvent,
  ClaimReviewProposalKind,
} from "@/lib/claimReview";
import type { AdminClusterRow } from "@/lib/adminClusters";
import { ACTION_TRANSPORT_FAILURE_MESSAGE, isActionTransportFailure } from "@/lib/actionTransportFailure";

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }) + " Eastern"
    : "Not recorded";
}

function proposalKindLabel(value: ClaimReviewProposalKind | null) {
  if (value === "keyword_proposal") return "Keyword suggestion";
  if (value === "llm_unsure") return "Uncertain AI match";
  if (value === "llm_sure") return "Confident AI match";
  return "Classification not recorded";
}

function ClaimCard({
  item,
  cluster,
  disabled,
  onSaved,
  events,
}: {
  item: ClaimReviewItem;
  cluster?: AdminClusterRow;
  disabled: boolean;
  onSaved: (decision: string) => void;
  events: ClaimReviewAuditEvent[];
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reviewRevision, setReviewRevision] = useState(() => ({ pairing: item.revision, lifecycle: item.clusterLifecycleRevision }));
  const [result, action, pending] = useActionState<ClaimReviewActionState, FormData>(
    async (previous, form) => {
      const decision = form.get("decision");
      const apply =
        decision === "confirm"
          ? confirmClaimReview
          : decision === "reject"
            ? rejectClaimReview
            : decision === "later"
              ? laterClaimReview
              : decision === "undo"
                ? undoClaimReview
                : null;
      if (!apply)
        return {
          ...previous,
          status: "validation_error" as const,
          message: "Choose a claim-review action.",
        };
      let next: ClaimReviewActionState;
      try {
        next = await apply(previous, form);
      } catch (error) {
        if (isActionTransportFailure(error)) {
          return { ...previous, status: "transport_error", message: ACTION_TRANSPORT_FAILURE_MESSAGE };
        }
        throw error;
      }
      if (next.status === "success") {
        if (next.revision !== null && next.clusterLifecycleRevision !== undefined) {
          setReviewRevision({ pairing: next.revision, lifecycle: next.clusterLifecycleRevision });
        }
        setRejecting(false);
        onSaved(String(decision));
      }
      return next;
    },
    initialClaimReviewActionState,
  );
  const isPending =
    !item.derivedHistoryReason &&
    (item.state === "pending" || item.state === "later");
  const canUndo =
    !item.derivedHistoryReason &&
    (item.state === "confirmed" || item.state === "rejected");
  return (
    <section
      className="workspace-panel workspace-detail"
      aria-labelledby={`claim-heading-${item.id}`}
    >
      <header className="workspace-detail-heading">
        <span
          className={`workspace-badge ${isPending ? "workspace-badge--amber" : ""}`}
        >
          {item.derivedHistoryReason
            ? "Historical pairing"
            : item.state === "later"
              ? "Decide later"
              : isPending
                ? "Proposed match"
                : item.state}
        </span>
        <h2 id={`claim-heading-${item.id}`} tabIndex={-1}>
          {item.clusterTitle}
        </h2>
        <p>
          Patch {item.patchVersion} ·{" "}
          {proposalKindLabel(item.proposalKind)}
        </p>
      </header>
      <form action={action} onReset={(event) => event.preventDefault()}>
        <input type="hidden" name="pairing_id" value={item.id} />
        <input type="hidden" name="revision" value={reviewRevision.pairing} />
        <input type="hidden" name="cluster_lifecycle_revision" value={reviewRevision.lifecycle} />
        <div className="workspace-panel-body">
          {item.derivedHistoryReason && (
            <p className="workspace-notice">
              {item.derivedHistoryReason} This record is read-only.
            </p>
          )}
          {result.message && (
            <div
              className={
                result.status === "success"
                  ? "workspace-notice"
                  : "workspace-error"
              }
              role="status"
            >
              {result.status === "success"
                ? "Claim decision saved."
                : result.status === "transport_error"
                  ? result.message
                  : result.status === "stale"
                  ? "This claim or issue changed after you opened it. Reload the current records before deciding. Nothing was changed by this attempt."
                  : result.status === "unavailable"
                    ? "Claim review is unavailable until its database update is applied. Nothing was saved."
                    : result.status === "validation_error"
                      ? "Check the review card and provide a reason between 3 and 500 characters when rejecting."
                      : "The decision could not be saved. Your reason is still here. Retry when the service is available."}
              {result.status === "stale" && (
                <button
                  type="button"
                  className="workspace-button"
                  onClick={() => window.location.reload()}
                >
                  Reload current records
                </button>
              )}
            </div>
          )}
          <div className="workspace-detail-section">
            <h3>What the official patch note says</h3>
            <blockquote className="workspace-quote">
              {item.exactOfficialText ||
                "The original claim text is unavailable for this legacy flag."}
            </blockquote>
            <p className="workspace-note">
              Exact patch {item.patchVersion}
              {item.officialSection ? ` · ${item.officialSection}` : ""}
            </p>
            {item.officialUrl && (
              <a
                className="workspace-text-link"
                href={externalWebHref(item.officialUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Read the official source
              </a>
            )}
          </div>
          <div className="workspace-detail-section">
            <h3>Issue on the board</h3>
            <p>{cluster?.description || item.clusterTitle}</p>
            <p className="workspace-note">
              {cluster?.admin_override
                ? "A manual lifecycle lock is active."
                : "Automatic lifecycle control"}
              {cluster
                ? ` · ${cluster.is_public ? "Public issue" : "Private issue"}`
                : ""}
              . Confirming this match records a claim, not a verified fix.
            </p>
          </div>
          <div className="workspace-notice">
            <strong>Why this was suggested</strong>
            <p>
              {item.proposalReason.replace(/^Needs review:\s*/, "") ||
                "Compare the exact official wording with the issue before deciding."}
            </p>
          </div>
          <details className="workspace-details">
            <summary>Proposal history and dates</summary>
            <dl className="workspace-health-facts">
              <dt>First scan sighting</dt>
              <dd>{dateLabel(item.firstSeenAt)}</dd>
              <dt>Last scan sighting</dt>
              <dd>{dateLabel(item.lastSeenAt)}</dd>
              <dt>Scan sightings</dt>
              <dd>{item.seenCount}</dd>
              <dt>Last seen by operator</dt>
              <dd>{dateLabel(item.seenByOperatorAt)}</dd>
            </dl>
            {item.rejectedReason && (
              <p className="workspace-note">
                Rejection reason: {item.rejectedReason}
              </p>
            )}
            {item.retiredReason && (
              <p className="workspace-note">
                Retired: {item.retiredReason.replaceAll("_", " ")}
              </p>
            )}
            {events.length > 0 && (
              <ol className="workspace-audit-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.action.replaceAll("_", " ")}</strong>
                    <span>
                      {dateLabel(event.occurredAt)} ·{" "}
                      {event.actor === "scanner"
                        ? "Scanner"
                        : "Signed-in operator"}
                    </span>
                    <span>Classification: {proposalKindLabel(event.proposalKind)}</span>
                    {event.reason && <p>{event.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </details>
          {rejecting && (
            <div className="workspace-detail-section">
              <label className="workspace-field">
                Why is this not the same issue?
                <textarea
                  ref={reasonRef}
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                  disabled={pending || disabled}
                />
              </label>
              <p className="workspace-note">
                Reject only this claim and issue pairing. The issue, player
                evidence and visibility stay unchanged.
              </p>
            </div>
          )}
        </div>
        <div className="workspace-actions">
          {isPending && !rejecting && (
            <>
              <button
                className="workspace-button workspace-button--primary"
                name="decision"
                value="confirm"
                disabled={disabled || pending}
              >
                Confirm match
              </button>
              <button
                type="button"
                className="workspace-button"
                disabled={disabled || pending}
                onClick={() => {
                  setRejecting(true);
                  requestAnimationFrame(() => reasonRef.current?.focus());
                }}
              >
                Not the same issue
              </button>
              <button
                className="workspace-button"
                name="decision"
                value="later"
                disabled={disabled || pending}
              >
                Decide later
              </button>
            </>
          )}
          {isPending && rejecting && (
            <>
              <button
                className="workspace-button workspace-button--primary"
                name="decision"
                value="reject"
                disabled={disabled || pending}
              >
                {pending ? "Saving…" : "Reject this match"}
              </button>
              <button
                type="button"
                className="workspace-button"
                disabled={pending}
                onClick={() => setRejecting(false)}
              >
                Cancel
              </button>
            </>
          )}
          {canUndo && (
            <button
              className="workspace-button"
              name="decision"
              value="undo"
              disabled={disabled || pending}
            >
              Undo decision
            </button>
          )}
          <p className="workspace-note">
            A lifecycle lock changes the whole issue. It is available separately
            in Settings & tools.
          </p>
        </div>
      </form>
    </section>
  );
}

export function ClaimWorkspace({
  queue,
  clusters,
  disabled,
  initialId,
}: {
  queue: ClaimReviewQueue;
  clusters: AdminClusterRow[];
  disabled: boolean;
  initialId?: string;
}) {
  const [tab, setTab] = useState<"pending" | "history">(
    queue.history.some((item) => item.id === initialId) ? "history" : "pending",
  );
  const [selected, setSelected] = useState(initialId ?? "");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [visited, setVisited] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const missing = queue.availability.status === "unavailable";
  const source = missing
    ? queue.legacyReadonly
    : tab === "pending"
      ? queue.pending
      : queue.history;
  const rows = source.filter((r) =>
    r.clusterTitle.toLowerCase().includes(search.toLowerCase()),
  );
  const active = rows.find((r) => r.id === selected) ?? rows[0];
  const eventsByPairing = new Map<string, ClaimReviewAuditEvent[]>();
  for (const event of queue.audit)
    eventsByPairing.set(event.pairingId, [
      ...(eventsByPairing.get(event.pairingId) ?? []),
      event,
    ]);
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <h1 tabIndex={-1} ref={heading}>
            Claim review
          </h1>
          <p>
            Compare each official fix with the issue. Confirm the pairing,
            reject it, or leave it for later.
          </p>
        </div>
        <span className="workspace-count">
          {missing
            ? "Review store unavailable"
            : `${queue.pendingCount} waiting`}
        </span>
      </header>
      {missing && (
        <div className="workspace-error" role="status">
          {queue.availability.status === "unavailable" &&
          queue.availability.reason === "missing_schema"
            ? "The durable claim-review update has not been applied yet. Existing flags are shown read-only; this is not an empty queue. Do not use Lock to dismiss a proposed match."
            : queue.availability.status === "unavailable" &&
              queue.availability.reason === "awaiting_sync"
              ? "The durable store is applied but the scanner has not recorded its first pass yet. Existing flags are shown read-only; this is not an empty queue. Do not use Lock to dismiss a proposed match."
              : "Claim review could not be read. Its count and history are unavailable, not zero."}
        </div>
      )}
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <div className="workspace-toolbar">
        <div className="workspace-tabs" aria-label="Claim review filter">
          <button
            type="button"
            className="workspace-tab"
            aria-pressed={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            Waiting for review
          </button>
          <button
            type="button"
            className="workspace-tab"
            aria-pressed={tab === "history"}
            disabled={missing}
            onClick={() => setTab("history")}
          >
            Decision history
          </button>
        </div>
        <label>
          <span className="sr-only">Search claim matches</span>
          <input
            className="workspace-search"
            type="search"
            placeholder="Search claim matches"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="workspace-split">
        <section className="workspace-panel workspace-review-list">
          <header className="workspace-panel-header">
            <h2>
              {tab === "pending" ? "Waiting for review" : "Decision history"}
            </h2>
            <span className="workspace-count">{rows.length}</span>
          </header>
          <div className="workspace-queue">
            {rows.map((r) => (
              <button
                type="button"
                key={r.id}
                className="workspace-queue-item"
                aria-current={active?.id === r.id ? "true" : undefined}
                onClick={() => {
                  setVisited((prior) => [
                    ...new Set([
                      ...prior,
                      ...(active ? [active.id] : []),
                      r.id,
                    ]),
                  ]);
                  setSelected(r.id);
                  requestAnimationFrame(() =>
                    document.getElementById(`claim-heading-${r.id}`)?.focus(),
                  );
                }}
              >
                <span className="workspace-badge workspace-badge--amber">
                  {r.derivedHistoryReason
                    ? "Historical pairing"
                    : r.state === "pending"
                      ? "Proposed match"
                      : r.state}
                </span>
                <strong>{r.clusterTitle}</strong>
                <small>Patch {r.patchVersion}</small>
              </button>
            ))}
            {!rows.length && (
              <div className="workspace-empty">
                <h3>
                  {missing ? "Records unavailable" : "No matches in this view"}
                </h3>
                <p>
                  {missing
                    ? "Restore the read before treating this as clear."
                    : "There are no claim decisions waiting in this view."}
                </p>
              </div>
            )}
          </div>
        </section>
        <div>
          {(missing
            ? queue.legacyReadonly
            : [...queue.pending, ...queue.history]
          )
            .filter(
              (item) => item.id === active?.id || visited.includes(item.id),
            )
            .map((item) => (
              <div key={item.id} hidden={active?.id !== item.id}>
                <ClaimCard
                  item={item}
                  cluster={clusterById.get(item.clusterId)}
                  events={(eventsByPairing.get(item.id) ?? []).toSorted(
                    (a, b) => b.occurredAt.localeCompare(a.occurredAt),
                  )}
                  disabled={
                    disabled ||
                    missing ||
                    !!clusterById.get(item.clusterId)?.admin_override
                  }
                  onSaved={(decision) => {
                    setTab(
                      decision === "later" || decision === "undo"
                        ? "pending"
                        : "history",
                    );
                    setSelected(item.id);
                    setNotice(
                      decision === "later"
                        ? "Left for later. This match remains in your queue."
                        : decision === "undo"
                          ? "Decision undone. This match is waiting for review again."
                          : "Decision saved. You can undo it in Decision history.",
                    );
                    heading.current?.focus();
                  }}
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
