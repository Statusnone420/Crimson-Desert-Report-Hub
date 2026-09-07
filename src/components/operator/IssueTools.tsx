import {
  clearClusterFixStatusOverride,
  setClusterFixStatus,
  setClusterVisibilityOverride,
  setCurrentPatchOverride,
} from "@/app/admin/actions";
import { VisibilityOverrideBrowser } from "@/components/admin/VisibilityOverrideBrowser";
import { SubmitButton } from "@/components/SubmitButton";
import type { AdminClusterRow } from "@/lib/adminClusters";
import type { FixStatus } from "@/lib/constants";
import { LIFECYCLE_LABELS } from "@/lib/lifecycle";
import { PATCH_VERSION_SHAPE } from "@/lib/officialPatch";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { splitClusterExceptions } from "@/lib/reportReview";
const LOCKABLE_STATUSES: FixStatus[] = [
  "reported",
  "fix_claimed",
  "verified_fixed",
  "persists",
];
const PATCH_PROVENANCE = {
  official: { label: "Synced", tone: "ledger-row__value--green" },
  manual: { label: "Manual", tone: "ledger-row__value--amber" },
  fallback: { label: "Unknown", tone: "ledger-row__value--amber" },
} as const;
export function IssueTools({
  clusters,
  currentPatch,
}: {
  clusters: AdminClusterRow[];
  currentPatch: Awaited<ReturnType<typeof getCurrentPatchMetadata>>;
}) {
  const { forcedRows, autoRows } = splitClusterExceptions(clusters);
  const lockedRows = clusters.filter((row) => row.admin_override);
  const patchProvenance = PATCH_PROVENANCE[currentPatch.source];
  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <h1>Settings &amp; tools</h1>
          <p>
            Lifecycle locks, visibility exceptions, and manual patch recovery.
          </p>
        </div>
      </header>
      <section className="workspace-panel">
        <header className="workspace-panel-header">
          <h2>Set a lifecycle lock</h2>
        </header>
        <div className="workspace-panel-body">
          <p className="workspace-note">
            This overrides automatic lifecycle decisions for the whole issue. It
            does not dismiss a claim pairing. Clear the lock below to return
            control to the scanner.
          </p>
          <form action={setClusterFixStatus} className="workspace-form">
            <label className="workspace-field">
              Issue
              <select name="cluster_id" required>
                <option value="">Choose an issue</option>
                {clusters.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="workspace-field">
              Locked status
              <select name="fix_status">
                {LOCKABLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {LIFECYCLE_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className="workspace-button" pendingText="Locking…">
              Set lifecycle lock
            </SubmitButton>
          </form>
        </div>
      </section>
      <section
        className="rule-band"
        aria-label="Exception ledger"
        style={{ marginBottom: 24 }}
      >
        <div className="section-head" style={{ paddingTop: 22 }}>
          <span className="mono-label">Records</span>
          <p className="op-note">
            Collapsed by default. Open a ledger to see the rows behind its
            count.
          </p>
        </div>
        <details>
          <summary className="ledger-row">
            <span className="mono-label">Lifecycle exceptions</span>
            <span className="ledger-row__copy">
              The system decides labels from counts. Only your active lifecycle
              locks appear here. Review proposed matches in Claim review.
              {lockedRows.length === 0
                ? " Nothing needs a call right now."
                : ""}
            </span>
            <span
              className={
                lockedRows.length > 0
                  ? "ledger-row__value ledger-row__value--amber"
                  : "ledger-row__value"
              }
            >
              {lockedRows.length} {lockedRows.length === 1 ? "item" : "items"}
              <i className="ledger-row__chevron" aria-hidden="true">
                ›
              </i>
            </span>
          </summary>
          <div className="ledger-body">
            {lockedRows.length === 0 ? (
              <p className="op-note">
                Nothing needs a call. Your active lifecycle locks appear here.
              </p>
            ) : (
              lockedRows.map((cluster) => (
                <div key={cluster.id} className="ledger-line">
                  <span>{cluster.title}</span>
                  <span className="mono-label">
                    {cluster.admin_override
                      ? "MAINTAINER LOCK"
                      : (LIFECYCLE_LABELS[
                          cluster.fix_status as keyof typeof LIFECYCLE_LABELS
                        ] ?? cluster.fix_status)}
                  </span>
                  {cluster.lifecycle_reason ? (
                    <span className="op-note" style={{ flexBasis: "100%" }}>
                      {cluster.lifecycle_reason}
                    </span>
                  ) : null}
                  <form
                    action={setClusterFixStatus}
                    className="dispatch-field flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="cluster_id" value={cluster.id} />
                    <label
                      className="sr-only"
                      htmlFor={`fix-status-${cluster.id}`}
                    >
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
                    <SubmitButton
                      className="tap-btn tap-btn--sm"
                      pendingText="Locking..."
                      describedBy={`lock-scope-${cluster.id}`}
                    >
                      Lock
                    </SubmitButton>
                  </form>
                  <p
                    className="scope-line"
                    id={`lock-scope-${cluster.id}`}
                    style={{ flexBasis: "100%" }}
                  >
                    <b>Lock</b> writes the selected lifecycle status, enables
                    the maintainer override, and stores its reason. Fix claimed,
                    Marked fixed, and Still happening also stamp the current
                    patch version and today&rsquo;s date as the claim date; Open
                    clears both. The lifecycle engine will not change that
                    status until you press Clear lock.
                  </p>
                  {cluster.admin_override ? (
                    <>
                      <form action={clearClusterFixStatusOverride}>
                        <input
                          type="hidden"
                          name="cluster_id"
                          value={cluster.id}
                        />
                        <SubmitButton
                          className="tap-btn tap-btn--sm tap-btn--recovery"
                          pendingText="Clearing lock..."
                          describedBy={`clear-lock-scope-${cluster.id}`}
                        >
                          Clear lock
                        </SubmitButton>
                      </form>
                      <p
                        className="scope-line"
                        id={`clear-lock-scope-${cluster.id}`}
                        style={{ flexBasis: "100%" }}
                      >
                        <b>Clear lock</b> releases engine ownership and clears
                        the stored reason and claim date. The current lifecycle
                        status remains until the next lifecycle scan.
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
              Force public/hidden takes effect immediately. Only active
              break-glass changes appear here, each with its reason and a
              one-click return to engine control.
            </span>
            <span
              className={
                forcedRows.length > 0
                  ? "ledger-row__value ledger-row__value--amber"
                  : "ledger-row__value"
              }
            >
              {forcedRows.length === 0
                ? "None active"
                : `${forcedRows.length} active`}
              <i className="ledger-row__chevron" aria-hidden="true">
                ›
              </i>
            </span>
          </summary>
          <div className="ledger-body">
            {forcedRows.length === 0 ? (
              <p className="op-note">
                Nothing is forced right now — every issue&apos;s visibility is
                engine-owned. Force is break-glass only; the scanner normally
                gets this right on its own.
              </p>
            ) : (
              forcedRows.map((cluster) => (
                <article key={cluster.id} className="override-card">
                  <div className="override-card__heading">
                    <div>
                      <p className="mono-label mono-label--amber">
                        FORCED{" "}
                        {cluster.admin_visibility_override === "force_public"
                          ? "PUBLIC"
                          : "HIDDEN"}{" "}
                        · {cluster.is_public ? "LIVE" : "HIDDEN"}
                      </p>
                      <h3>{cluster.title}</h3>
                    </div>
                    <form action={setClusterVisibilityOverride}>
                      <input
                        type="hidden"
                        name="cluster_id"
                        value={cluster.id}
                      />
                      <input type="hidden" name="visibility" value="auto" />
                      <SubmitButton
                        className="tap-btn tap-btn--sm tap-btn--recovery"
                        pendingText="Resetting..."
                        describedBy={`reset-scope-${cluster.id}`}
                      >
                        Reset to automatic
                      </SubmitButton>
                    </form>
                  </div>
                  <p>
                    {cluster.admin_visibility_reason ??
                      "Existing override created before reason tracking."}
                  </p>
                  <p className="scope-line" id={`reset-scope-${cluster.id}`}>
                    <b>Reset</b> clears the override reason and timestamp,
                    immediately restores this cluster&apos;s saved automatic
                    public baseline, and recomputes every signal&apos;s
                    visibility in the same action, so the cluster and its
                    signals may appear on or leave the Issue Board now. If the
                    signal recompute fails, the reset itself is already
                    committed and the failure is raised, not hidden.
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
            Deliberate friction lives here on purpose. Nothing in this band is
            part of a normal day.
          </p>
        </div>
        <details>
          <summary className="ledger-row" style={{ borderBottom: 0 }}>
            <span className="mono-label">Current patch override</span>
            <span className="ledger-row__copy">
              If the scanner stops finding Pearl Abyss patch notes, set the
              current patch by hand. This version-only override has no manual
              Undo; the next successful official patch sync takes control back.
              Changing it also swaps which observations the Scanner Monitor desk
              can moderate.
            </span>
            <span className={`ledger-row__value ${patchProvenance.tone}`}>
              {patchProvenance.label} {currentPatch.version}
              <i className="ledger-row__chevron" aria-hidden="true">
                ›
              </i>
            </span>
          </summary>
          <form
            action={setCurrentPatchOverride}
            className="ledger-body dispatch-field"
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
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
            <SubmitButton
              className="tap-btn tap-btn--sm tap-btn--breakglass"
              pendingText="Saving..."
              describedBy="set-patch-scope"
            >
              Set current patch
            </SubmitButton>
            <p
              className="scope-line"
              id="set-patch-scope"
              style={{ flexBasis: "100%" }}
            >
              <b>Set current patch</b> makes this manual version current across
              the site. There is no Clear or Undo, and the manual row itself
              adds no official fix claims. Until the next successful official
              patch sync replaces it, every current-patch surface labels it
              Manual rather than Synced, and patch-burst scan cadence stays off.
              It also changes the Scanner Monitor window: older observations
              lose card-level Undo, and Active lessons retains rule revocation
              only while a rule remains active, unrevoked, and unexpired.
            </p>
          </form>
        </details>
      </section>
    </div>
  );
}
