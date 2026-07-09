import Link from "next/link";
import { clearClusterFixStatusOverride, moderateReport, setClusterFixStatus, signOutAdmin } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FixStatusBadge, SectionHeader, StatCard } from "@/components/ui";
import { CATEGORY_LABELS, FIX_STATUSES, PLATFORM_LABELS } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { LIFECYCLE_LABELS } from "@/lib/lifecycle";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const [{ data: flagged }, { data: clusters }, approved, pending, spam] = await Promise.all([
    supabase
      .from("bug_reports")
      .select("*")
      .eq("moderation_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase.from("issue_clusters").select("id, title, fix_status, admin_override, lifecycle_reason").order("title"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "spam"),
  ]);

  const flaggedReports = flagged ?? [];
  const clusterRows = clusters ?? [];
  const lifecycleExceptionRows = clusterRows.filter((cluster) => String(cluster.lifecycle_reason ?? "").startsWith("Needs review:"));
  const needsYou = (pending.count ?? 0) + lifecycleExceptionRows.length;

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Admin controls"
        title="Report review"
        description="Auto-sorted reports, flagged submissions, and issue fix-status controls."
        action={
          <div className="grid w-[calc(100vw-2rem)] grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap">
            <Link className="btn btn-ghost btn-sm justify-center" href="/scanner">
              Scanner monitor
            </Link>
            <Link className="btn btn-ghost btn-sm justify-center" href="/admin/compile">
              Compile dossier
            </Link>
            <a className="btn btn-ghost btn-sm justify-center" href="/api/admin/export">
              Export CSV
            </a>
            <form action={signOutAdmin} className="min-w-0 sm:w-auto">
              <SubmitButton className="btn btn-ghost btn-sm w-full justify-center" pendingText="Signing out...">
                Sign out
              </SubmitButton>
            </form>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Needs you" value={needsYou} note={needsYou === 0 ? "No exceptions" : "Review exceptions"} tone={needsYou > 0 ? "amber" : "green" } />
        <StatCard label="Auto-sorted" value={approved.count ?? 0} note="Approved automatically" tone="green" />
        <StatCard label="Flagged reports" value={pending.count ?? 0} note="Waiting for your call" tone="amber" />
        <StatCard label="Filtered as spam" value={spam.count ?? 0} note="Blocked automatically" tone="dim" />
      </section>

      <section className="space-y-3">
        <div className="stat-label">Flagged for review</div>
        {flaggedReports.length === 0 ? (
          <div className="panel panel-inset flex flex-col items-center gap-2 py-10 text-center">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: "var(--green-tint)", border: "1px solid var(--green-edge)" }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="var(--green-bright)" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="text-base font-semibold">All clear</h3>
            <p className="max-w-md text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              No flagged reports need review.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {flaggedReports.map((report) => (
              <article key={report.id} className="panel space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
                  <span className="badge badge-dim">
                    {PLATFORM_LABELS[report.platform as keyof typeof PLATFORM_LABELS] ?? report.platform}
                  </span>
                  <span className="badge badge-dim">
                    {CATEGORY_LABELS[report.category as keyof typeof CATEGORY_LABELS] ?? report.category}
                  </span>
                  <span className="badge badge-amber">
                    {report.severity} · {report.frequency}
                  </span>
                  <span className="num">patch {report.patch_version}</span>
                  <span className="num">{new Date(report.created_at).toLocaleString()}</span>
                </div>

                <div>
                  <p className="font-semibold">{report.issue_title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--text-dim)" }}>
                    {report.description}
                  </p>
                  {report.repro_steps ? (
                    <p className="mt-2 text-sm">
                      <span className="stat-label">Repro </span>
                      {report.repro_steps}
                    </p>
                  ) : null}
                  {report.hardware_specs ? (
                    <p className="text-sm">
                      <span className="stat-label">Hardware </span>
                      {report.hardware_specs}
                    </p>
                  ) : null}
                  {report.evidence_url ? (
                    <p className="text-sm">
                      <span className="stat-label">Evidence </span>
                      <a
                        href={report.evidence_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="link break-all"
                      >
                        {report.evidence_url}
                      </a>
                    </p>
                  ) : null}
                </div>

                <form action={moderateReport} className="grid gap-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
                  <input type="hidden" name="id" value={report.id} />
                  <select name="cluster_id" defaultValue={report.cluster_id ?? ""} className="min-w-0">
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
                    className="min-w-0"
                  />
                  <button className="btn btn-sm" name="decision" value="approved">
                    Approve
                  </button>
                  <button className="btn btn-ghost btn-sm" name="decision" value="rejected">
                    Reject
                  </button>
                  <button className="btn btn-ghost btn-sm" name="decision" value="spam">
                    Spam
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="panel" open={lifecycleExceptionRows.length > 0}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 space-y-1">
            <span className="stat-label block">Advanced lifecycle overrides</span>
            <span className="block text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              No action needed unless a system label is wrong or an exception appears here.
            </span>
          </span>
          <span className={lifecycleExceptionRows.length > 0 ? "badge badge-amber" : "badge badge-dim"}>
            {lifecycleExceptionRows.length} exceptions
          </span>
        </summary>
        <div className="mt-4 space-y-2 border-t pt-4">
          {clusterRows.map((cluster) => (
            <div key={cluster.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{cluster.title}</span>
              <FixStatusBadge status={cluster.fix_status} adminOverride={Boolean(cluster.admin_override)} />
              {cluster.lifecycle_reason ? (
                <span className="min-w-48 flex-1 text-xs" style={{ color: "var(--text-dim)" }}>
                  {cluster.lifecycle_reason}
                </span>
              ) : null}
              <form action={setClusterFixStatus} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="cluster_id" value={cluster.id} />
                <select name="fix_status" defaultValue={cluster.fix_status} className="w-44">
                  {FIX_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {LIFECYCLE_LABELS[status] ?? status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Locking...">
                  Lock
                </SubmitButton>
              </form>
              {cluster.admin_override ? (
                <form action={clearClusterFixStatusOverride}>
                  <input type="hidden" name="cluster_id" value={cluster.id} />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="Clearing...">
                    Clear
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
