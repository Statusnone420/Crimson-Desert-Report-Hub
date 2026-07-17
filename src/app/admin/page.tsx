import {
  clearClusterFixStatusOverride,
  moderateReport,
  setClusterFixStatus,
  setClusterVisibilityOverride,
  setCurrentPatchOverride,
} from "@/app/admin/actions";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { SubmitButton } from "@/components/SubmitButton";
import { CATEGORY_LABELS, PLATFORM_LABELS, type FixStatus } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { LIFECYCLE_LABELS } from "@/lib/lifecycle";
import { PATCH_VERSION_SHAPE } from "@/lib/officialPatch";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// acknowledged is a dead state: no rule produces it, so the lock menu doesn't offer it.
const LOCKABLE_STATUSES: FixStatus[] = ["reported", "fix_claimed", "verified_fixed", "persists"];

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const [{ data: flagged }, { data: clusters }, approved, pending, spam, currentPatch] = await Promise.all([
    supabase
      .from("bug_reports")
      .select("*")
      .eq("moderation_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("issue_clusters")
      .select("id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, is_public")
      .order("title"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "spam"),
    getCurrentPatchMetadata(supabase),
  ]);

  const flaggedReports = flagged ?? [];
  const clusterRows = clusters ?? [];
  const exceptionRows = clusterRows.filter(
    (cluster) => String(cluster.lifecycle_reason ?? "").startsWith("Needs review:") || cluster.admin_override,
  );
  const forcedVisibility = clusterRows.filter((cluster) => cluster.admin_visibility_override).length;
  const needsYou = (pending.count ?? 0) + exceptionRows.filter((cluster) => !cluster.admin_override).length;

  return (
    <OperatorShell active="review">
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 32 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker dispatch-kicker--amber">Operator · Admin controls</p>
            <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
              Report review
            </h1>
            <p className="dispatch-pagehead__dek" style={{ maxWidth: "56ch" }}>
              Auto-sorted reports, flagged submissions, and the short list of exceptions that actually need you.
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
            <div className="stat-band__caption">{needsYou === 0 ? "No exceptions" : "Review exceptions"}</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Auto-sorted</div>
            <div className="stat-band__value">{approved.count ?? 0}</div>
            <div className="stat-band__caption">Approved automatically</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Flagged reports</div>
            <div className="stat-band__value">{pending.count ?? 0}</div>
            <div className="stat-band__caption">Waiting for your call</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Filtered as spam</div>
            <div className="stat-band__value">{spam.count ?? 0}</div>
            <div className="stat-band__caption">Blocked automatically</div>
          </div>
        </div>

        <section className="review-band" aria-label="Flagged for review">
          <div className="mono-label" style={{ display: "block", marginBottom: 14 }}>
            Flagged for review
          </div>
          {flaggedReports.length === 0 ? (
            <>
              <p className="review-clear">✓ All clear — no flagged reports need review</p>
              <p className="op-note" style={{ marginTop: 6 }}>
                New flags appear here with the full private text, the auto-sort reason, and approve / reject /
                spam controls with cluster selection.
              </p>
            </>
          ) : (
            flaggedReports.map((report) => (
              <article key={report.id} className="review-item">
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
                  <select name="cluster_id" defaultValue={report.cluster_id ?? ""} style={{ width: "auto" }}>
                    <option value="">No cluster</option>
                    {clusterRows.map((cluster) => (
                      <option key={cluster.id} value={cluster.id}>
                        {cluster.title}
                      </option>
                    ))}
                  </select>
                  <input
                    name="excerpt"
                    placeholder="Public excerpt, anonymized, max 500 chars"
                    maxLength={500}
                    style={{ flex: 1, minWidth: 220, width: "auto" }}
                  />
                  <button className="dispatch-btn" name="decision" value="approved">
                    Approve
                  </button>
                  <button className="tap-btn" name="decision" value="rejected">
                    Reject
                  </button>
                  <button className="tap-btn" name="decision" value="spam">
                    Spam
                  </button>
                </form>
              </article>
            ))
          )}
        </section>

        <section className="rule-band" aria-label="Exception ledger" style={{ marginBottom: 24 }}>
          <details>
            <summary className="ledger-row">
              <span className="mono-label">Lifecycle exceptions</span>
              <span className="ledger-row__copy">
                The system decides labels from counts. Only unsure claim matches and your own locks appear here.
                {exceptionRows.length === 0 ? " Nothing needs a call right now." : ""}
              </span>
              <span className={exceptionRows.length > 0 ? "ledger-row__value ledger-row__value--amber" : "ledger-row__value"}>
                {exceptionRows.length} {exceptionRows.length === 1 ? "item" : "items"}
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
                      <select name="fix_status" defaultValue={cluster.fix_status} style={{ width: 220 }}>
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
                    {cluster.admin_override ? (
                      <form action={clearClusterFixStatusOverride}>
                        <input type="hidden" name="cluster_id" value={cluster.id} />
                        <SubmitButton className="tap-btn tap-btn--sm" pendingText="Clearing...">
                          Clear
                        </SubmitButton>
                      </form>
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
                Force public/hidden takes effect immediately. Auto immediately recomputes engine-owned visibility.
              </span>
              <span className={forcedVisibility > 0 ? "ledger-row__value ledger-row__value--amber" : "ledger-row__value"}>
                {forcedVisibility} forced
              </span>
            </summary>
            <div className="ledger-body">
              {clusterRows.map((cluster) => (
                <form
                  key={cluster.id}
                  action={setClusterVisibilityOverride}
                  className="ledger-line dispatch-field"
                >
                  <input type="hidden" name="cluster_id" value={cluster.id} />
                  <span>{cluster.title}</span>
                  <span className="mono-label">{cluster.is_public ? "PUBLIC" : "PRIVATE"}</span>
                  <select name="visibility" defaultValue={cluster.admin_visibility_override ?? "auto"} style={{ width: 170 }}>
                    <option value="auto">Auto (engine)</option>
                    <option value="force_public">Force public</option>
                    <option value="force_hidden">Force hidden</option>
                  </select>
                  <SubmitButton className="tap-btn tap-btn--sm" pendingText="Saving...">
                    Apply
                  </SubmitButton>
                </form>
              ))}
            </div>
          </details>

          <details>
            <summary className="ledger-row" style={{ borderBottom: 0 }}>
              <span className="mono-label">Current patch override</span>
              <span className="ledger-row__copy">
                Break-glass only: if the scanner stops finding Pearl Abyss patch notes, set the current patch by
                hand. The next successful scan takes control back.
              </span>
              <span
                className={
                  currentPatch.source === "official" ? "ledger-row__value ledger-row__value--green" : "ledger-row__value ledger-row__value--amber"
                }
              >
                {currentPatch.source === "official" ? `Synced ${currentPatch.version}` : `Fallback ${currentPatch.version}`}
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
              <SubmitButton className="tap-btn tap-btn--sm" pendingText="Saving...">
                Set current patch
              </SubmitButton>
            </form>
          </details>
        </section>
      </div>
    </OperatorShell>
  );
}
