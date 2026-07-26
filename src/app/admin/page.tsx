import {
  clearClusterFixStatusOverride,
  moderateReport,
  setClusterFixStatus,
  setClusterVisibilityOverride,
  setCurrentPatchOverride,
} from "@/app/admin/actions";
import { VisibilityOverrideBrowser } from "@/components/admin/VisibilityOverrideBrowser";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { SubmitButton } from "@/components/SubmitButton";
import { readAdminClusters } from "@/lib/adminClusters";
import { CATEGORY_LABELS, PLATFORM_LABELS, type FixStatus } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { LIFECYCLE_LABELS } from "@/lib/lifecycle";
import { PATCH_VERSION_SHAPE } from "@/lib/officialPatch";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { FLAGGED_WINDOW, readReportReviewQueue } from "@/lib/reportReview";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// acknowledged is a dead state: no rule produces it, so the lock menu doesn't offer it.
const LOCKABLE_STATUSES: FixStatus[] = ["reported", "fix_claimed", "verified_fixed", "persists"];

const PATCH_PROVENANCE = {
  official: { label: "Synced", tone: "ledger-row__value--green" },
  manual: { label: "Manual", tone: "ledger-row__value--amber" },
  fallback: { label: "Unknown", tone: "ledger-row__value--amber" },
} as const;

export default async function AdminPage() {
  await requireAdmin("/admin");
  const supabase = createServiceClient();

  // Every read either succeeds or throws into the admin error boundary. A
  // fabricated zero here would render a green "All clear" the data cannot back.
  const [queue, clusterRows, currentPatch] = await Promise.all([
    readReportReviewQueue(supabase),
    readAdminClusters(supabase),
    getCurrentPatchMetadata(supabase),
  ]);

  const { flaggedReports, approvedCount, pendingCount, spamCount } = queue;
  // Break-glass split: forced clusters are exceptions and stay visible; engine-owned
  // rows collapse behind a disclosure instead of rendering a dropdown farm.
  const forcedRows = clusterRows.filter((cluster) => cluster.admin_visibility_override);
  const autoRows = clusterRows.filter((cluster) => !cluster.admin_visibility_override);
  const exceptionRows = clusterRows.filter(
    (cluster) => String(cluster.lifecycle_reason ?? "").startsWith("Needs review:") || cluster.admin_override,
  );
  const unsureClaimRows = exceptionRows.filter((cluster) => !cluster.admin_override);
  const needsYou = pendingCount + unsureClaimRows.length;
  const patchProvenance = PATCH_PROVENANCE[currentPatch.source];
  const needsYouParts = [
    pendingCount > 0 ? `${pendingCount} flagged ${pendingCount === 1 ? "report" : "reports"}` : null,
    unsureClaimRows.length > 0
      ? `${unsureClaimRows.length} unsure claim ${unsureClaimRows.length === 1 ? "match" : "matches"}`
      : null,
  ].filter(Boolean);

  return (
    <OperatorShell active="review">
      <div className="dispatch-container">
        {/* 1 · Status and required work */}
        <header className="dispatch-pagehead" style={{ paddingBottom: 32 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker dispatch-kicker--amber">Operator · Admin controls</p>
            <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
              Report review
            </h1>
            <p className="dispatch-pagehead__dek" style={{ maxWidth: "56ch" }}>
              Report statuses, flagged submissions, and the short list of exceptions that actually need you.
            </p>
          </div>
          <div className="dispatch-pagehead__status">LIVE QUEUE · REFRESHES ON LOAD</div>
        </header>

        <div className="stat-band" aria-label="Queue summary">
          <div className="stat-band__cell">
            <div className="stat-band__label">Needs you</div>
            <div
              className={
                needsYou > 0 ? "stat-band__value stat-band__value--crimson" : "stat-band__value stat-band__value--green"
              }
            >
              {needsYou}
            </div>
            <div className="stat-band__caption">
              {needsYouParts.length > 0 ? needsYouParts.join(" · ") : "No exceptions"}
            </div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Approved reports</div>
            <div className="stat-band__value">{approvedCount}</div>
            <div className="stat-band__caption">Currently approved</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Flagged reports</div>
            <div className={pendingCount > 0 ? "stat-band__value stat-band__value--amber" : "stat-band__value"}>
              {pendingCount}
            </div>
            <div className="stat-band__caption">Waiting for your call</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Spam</div>
            <div className="stat-band__value">{spamCount}</div>
            <div className="stat-band__caption">Currently marked spam</div>
          </div>
        </div>

        {/* 2 · Primary task */}
        <section className="review-band" aria-label="Flagged for review">
          <div className="section-head">
            <span className="mono-label">Flagged for review</span>
            <p className="op-note">
              {flaggedReports.length === 0
                ? "Oldest first · showing all 0"
                : `Oldest first · showing ${flaggedReports.length} of ${pendingCount}${
                    pendingCount > FLAGGED_WINDOW ? ` · ${FLAGGED_WINDOW}-row window` : ""
                  }`}
            </p>
          </div>
          {flaggedReports.length === 0 ? (
            <>
              <p className="review-clear">✓ All clear — no flagged reports need review</p>
              <p className="op-note" style={{ marginTop: 6 }}>
                New flags appear here with the full private text and approve / reject / spam controls with cluster
                selection. The stored report state does not retain whether automation or an operator made an earlier
                decision.
              </p>
            </>
          ) : (
            flaggedReports.map((report) => (
              <article key={report.id} className="review-item review-item--raised">
                <div className="review-item__meta">
                  {PLATFORM_LABELS[report.platform as keyof typeof PLATFORM_LABELS] ?? report.platform} ·{" "}
                  {CATEGORY_LABELS[report.category as keyof typeof CATEGORY_LABELS] ?? report.category} ·{" "}
                  {report.severity} · {report.frequency} · patch {report.patch_version} ·{" "}
                  {new Date(report.created_at).toLocaleString()}
                </div>
                <h2 className="review-item__title">{report.issue_title}</h2>
                <p className="review-item__body">{report.description}</p>
                {report.repro_steps ? <p className="review-item__detail">Repro: {report.repro_steps}</p> : null}
                {report.hardware_specs ? (
                  <p className="review-item__detail">Hardware: {report.hardware_specs}</p>
                ) : null}
                {report.evidence_url ? (
                  <p className="review-item__detail">
                    Evidence:{" "}
                    <a
                      href={report.evidence_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="dispatch-link break-all"
                    >
                      {report.evidence_url}
                    </a>
                  </p>
                ) : null}
                <form action={moderateReport} className="review-item__form dispatch-field">
                  <input type="hidden" name="id" value={report.id} />
                  <label className="field-label" htmlFor={`cluster-${report.id}`}>
                    Cluster
                  </label>
                  <select
                    id={`cluster-${report.id}`}
                    name="cluster_id"
                    defaultValue={report.cluster_id ?? ""}
                    style={{ width: "auto" }}
                  >
                    <option value="">No cluster</option>
                    {clusterRows.map((cluster) => (
                      <option key={cluster.id} value={cluster.id}>
                        {cluster.title}
                      </option>
                    ))}
                  </select>
                  <input
                    name="excerpt"
                    aria-label="Public excerpt, anonymized, max 500 characters"
                    placeholder="Public excerpt, anonymized, max 500 chars"
                    maxLength={500}
                    style={{ flex: 1, minWidth: 220, width: "auto" }}
                  />
                  <SubmitButton className="dispatch-btn" pendingText="Approving..." name="decision" value="approved">
                    Approve
                  </SubmitButton>
                  <SubmitButton
                    className="tap-btn tap-btn--destructive"
                    pendingText="Rejecting..."
                    name="decision"
                    value="rejected"
                  >
                    Reject
                  </SubmitButton>
                  <SubmitButton
                    className="tap-btn tap-btn--destructive"
                    pendingText="Marking spam..."
                    name="decision"
                    value="spam"
                  >
                    Spam
                  </SubmitButton>
                </form>
                <div className="decision-scopes">
                  <p className="scope-line">
                    <b>Approve</b> marks the report approved. With a selected cluster, it counts as evidence and
                    normally makes that cluster public on the Issue Board immediately; an active Force hidden override
                    still wins. A non-empty anonymized excerpt is inserted separately afterward. If that insert fails,
                    approval and any resulting public visibility remain committed, the report leaves this queue, and
                    there is no rendered excerpt retry.
                  </p>
                  <p className="scope-line">
                    All three decisions remove the report from the pending queue. The current console does not render a
                    re-open or excerpt-retry control. Reject and Spam also write the cluster selection above.
                  </p>
                </div>
              </article>
            ))
          )}
        </section>

        {/* 4 · Records and history */}
        <section className="rule-band" aria-label="Exception ledger" style={{ marginBottom: 24 }}>
          <div className="section-head" style={{ paddingTop: 22 }}>
            <span className="mono-label">Records</span>
            <p className="op-note">Collapsed by default. Open a ledger to see the rows behind its count.</p>
          </div>
          <details>
            <summary className="ledger-row">
              <span className="mono-label">Lifecycle exceptions</span>
              <span className="ledger-row__copy">
                The system decides labels from counts. Only unsure claim matches and your own locks appear here.
                {exceptionRows.length === 0 ? " Nothing needs a call right now." : ""}
              </span>
              <span className={exceptionRows.length > 0 ? "ledger-row__value ledger-row__value--amber" : "ledger-row__value"}>
                {exceptionRows.length} {exceptionRows.length === 1 ? "item" : "items"}
                <i className="ledger-row__chevron" aria-hidden="true">›</i>
              </span>
            </summary>
            <div className="ledger-body">
              {exceptionRows.length === 0 ? (
                <p className="op-note">Nothing needs a call. Locks you set and unsure claim matches will surface here.</p>
              ) : (
                exceptionRows.map((cluster) => (
                  <div key={cluster.id} className="ledger-line">
                    <span>{cluster.title}</span>
                    <span className="mono-label">
                      {cluster.admin_override
                        ? "MAINTAINER LOCK"
                        : (LIFECYCLE_LABELS[cluster.fix_status as keyof typeof LIFECYCLE_LABELS] ?? cluster.fix_status)}
                    </span>
                    {cluster.lifecycle_reason ? (
                      <span className="op-note" style={{ flexBasis: "100%" }}>
                        {cluster.lifecycle_reason}
                      </span>
                    ) : null}
                    <form action={setClusterFixStatus} className="dispatch-field flex flex-wrap items-center gap-2">
                      <input type="hidden" name="cluster_id" value={cluster.id} />
                      <label className="sr-only" htmlFor={`fix-status-${cluster.id}`}>
                        Lifecycle status for {cluster.title}
                      </label>
                      <select
                        id={`fix-status-${cluster.id}`}
                        name="fix_status"
                        defaultValue={cluster.fix_status}
                        style={{ width: 220 }}
                      >
                        {LOCKABLE_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {LIFECYCLE_LABELS[status]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="tap-btn tap-btn--sm" pendingText="Locking...">
                        Lock
                      </SubmitButton>
                    </form>
                    <p className="scope-line" style={{ flexBasis: "100%" }}>
                      <b>Lock</b> writes the selected lifecycle status, enables the maintainer override, and stores its
                      reason. Fix claimed, Marked fixed, and Still happening also stamp the current patch version and a
                      new claim clock; Open clears both. The lifecycle engine will not change that status until you
                      press Clear lock.
                    </p>
                    {cluster.admin_override ? (
                      <>
                        <form action={clearClusterFixStatusOverride}>
                          <input type="hidden" name="cluster_id" value={cluster.id} />
                          <SubmitButton
                            className="tap-btn tap-btn--sm tap-btn--recovery"
                            pendingText="Clearing lock..."
                          >
                            Clear lock
                          </SubmitButton>
                        </form>
                        <p className="scope-line" style={{ flexBasis: "100%" }}>
                          <b>Clear lock</b> releases engine ownership and clears the stored reason and claim clock. The
                          current lifecycle status remains until the next lifecycle scan.
                        </p>
                      </>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </details>

          <details>
            <summary className="ledger-row">
              <span className="mono-label">Visibility overrides</span>
              <span className="ledger-row__copy">
                Force public/hidden takes effect immediately. Only active break-glass changes appear here, each
                with its reason and a one-click return to engine control.
              </span>
              <span className={forcedRows.length > 0 ? "ledger-row__value ledger-row__value--amber" : "ledger-row__value"}>
                {forcedRows.length === 0 ? "None active" : `${forcedRows.length} active`}
                <i className="ledger-row__chevron" aria-hidden="true">›</i>
              </span>
            </summary>
            <div className="ledger-body">
              {forcedRows.length === 0 ? (
                <p className="op-note">
                  Nothing is forced right now — every issue&apos;s visibility is engine-owned. Force is
                  break-glass only; the scanner normally gets this right on its own.
                </p>
              ) : (
                forcedRows.map((cluster) => (
                  <article key={cluster.id} className="override-card">
                    <div className="override-card__heading">
                      <div>
                        <p className="mono-label mono-label--amber">
                          FORCED {cluster.admin_visibility_override === "force_public" ? "PUBLIC" : "HIDDEN"} · {cluster.is_public ? "LIVE" : "HIDDEN"}
                        </p>
                        <h3>{cluster.title}</h3>
                      </div>
                      <form action={setClusterVisibilityOverride}>
                        <input type="hidden" name="cluster_id" value={cluster.id} />
                        <input type="hidden" name="visibility" value="auto" />
                        <SubmitButton
                          className="tap-btn tap-btn--sm tap-btn--recovery"
                          pendingText="Resetting..."
                        >
                          Reset to automatic
                        </SubmitButton>
                      </form>
                    </div>
                    <p>{cluster.admin_visibility_reason ?? "Existing override created before reason tracking."}</p>
                    <p className="scope-line">
                      <b>Reset</b> clears the override reason and timestamp, immediately restores this cluster&apos;s
                      saved automatic public baseline, and recomputes every signal&apos;s visibility in the same
                      action, so the cluster and its signals may appear on or leave the Issue Board now. If the signal
                      recompute fails, the reset itself is already committed and the failure is raised, not hidden.
                    </p>
                    <span className="override-card__time">
                      {cluster.admin_visibility_changed_at
                        ? `Changed ${new Date(cluster.admin_visibility_changed_at).toLocaleString()}`
                        : "Change time unavailable"}
                    </span>
                  </article>
                ))
              )}
              <VisibilityOverrideBrowser clusters={autoRows} />
            </div>
          </details>
        </section>

        {/* 5 · Advanced / break-glass */}
        <section className="rule-band" aria-label="Break-glass configuration">
          <div className="section-head" style={{ paddingTop: 22 }}>
            <span className="mono-label">Break-glass</span>
            <p className="op-note">
              Deliberate friction lives here on purpose. Nothing in this band is part of a normal day.
            </p>
          </div>
          <details>
            <summary className="ledger-row" style={{ borderBottom: 0 }}>
              <span className="mono-label">Current patch override</span>
              <span className="ledger-row__copy">
                If the scanner stops finding Pearl Abyss patch notes, set the current patch by hand. This
                version-only override has no manual Undo; the next successful official patch sync takes control back.
              </span>
              <span className={`ledger-row__value ${patchProvenance.tone}`}>
                {patchProvenance.label} {currentPatch.version}
                <i className="ledger-row__chevron" aria-hidden="true">›</i>
              </span>
            </summary>
            <form
              action={setCurrentPatchOverride}
              className="ledger-body dispatch-field"
              style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}
            >
              <label htmlFor="patch_version_override" style={{ marginBottom: 0 }}>
                New current patch
              </label>
              <input
                id="patch_version_override"
                name="patch_version"
                placeholder={currentPatch.version}
                pattern={PATCH_VERSION_SHAPE.source}
                title="Version like 1.13.02"
                required
                style={{ width: 130 }}
              />
              <SubmitButton className="tap-btn tap-btn--sm tap-btn--breakglass" pendingText="Saving...">
                Set current patch
              </SubmitButton>
              <p className="scope-line" style={{ flexBasis: "100%" }}>
                <b>Set current patch</b> makes this manual version current across the site. There is no Clear or Undo,
                and the manual row itself adds no official fix claims. Until the next successful official patch sync
                replaces it, every current-patch surface labels it Manual rather than Synced, and patch-burst scan
                cadence stays off.
              </p>
            </form>
          </details>
        </section>
      </div>
    </OperatorShell>
  );
}
