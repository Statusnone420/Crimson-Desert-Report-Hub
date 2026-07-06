import Link from "next/link";
import {
  moderateReport,
  runAutomationCappedScan,
  runAutomationDryScan,
  setAutomationPaused,
  setClusterFixStatus,
} from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FixStatusBadge, SectionHeader, StatCard } from "@/components/ui";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { CATEGORY_LABELS, FIX_STATUSES, PLATFORM_LABELS } from "@/lib/constants";
import { automationBudgetUsd, features } from "@/lib/env";
import { requireAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type AutomationDashboardRun = {
  started_at: string;
  status: string;
  mode: string;
  estimated_cost_usd: number;
  search_queries_used: number;
  llm_calls_used: number;
  signals_inserted: number;
  signals_deduped: number;
  clusters_promoted: number;
  skips: string[];
  errors: string[];
};

function runSummary(run: AutomationDashboardRun): string {
  const base = `${run.search_queries_used} searches, ${run.llm_calls_used} LLM calls`;
  if (run.mode === "dry_run") return `${base}, ${run.signals_inserted} would insert, nothing public saved`;
  return `${base}, ${run.signals_inserted} inserted, ${run.signals_deduped} deduped, ${run.clusters_promoted} promoted`;
}

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const [{ data: flagged }, { data: clusters }, approved, pending, spam, latestAutomation, automationControl] =
    await Promise.all([
      supabase
        .from("bug_reports")
        .select("*")
        .eq("moderation_status", "pending")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase.from("issue_clusters").select("id, title, fix_status").order("title"),
      supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
      supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
      supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", "spam"),
      supabase
        .from("automation_runs")
        .select(
          "started_at, status, mode, estimated_cost_usd, search_queries_used, llm_calls_used, signals_inserted, signals_deduped, clusters_promoted, skips, errors",
        )
        .order("started_at", { ascending: false })
        .limit(1),
      getAutomationControlState(supabase as unknown as AutomationSettingsClient),
    ]);

  const flaggedReports = flagged ?? [];
  const latestRun = ((latestAutomation.data ?? []) as AutomationDashboardRun[])[0] ?? null;
  const latestMessages = latestRun ? summarizeRunMessages(latestRun.skips, latestRun.errors) : null;
  const f = features();
  const budget = automationBudgetUsd();

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Owner console"
        title="Auto-moderation"
        description="Reports are checked and sorted automatically the moment they arrive — spam-gated, clustered, and approved by deterministic rules, with an optional AI screen when configured. This queue only holds the few flagged for a human look."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-ghost btn-sm" href="/admin/source-monitor">
              Source monitor
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/admin/compile">
              Compile dossier
            </Link>
            <a className="btn btn-ghost btn-sm" href="/api/admin/export">
              Export CSV
            </a>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Auto-sorted" value={approved.count ?? 0} note="Approved without a human" tone="green" />
        <StatCard label="Flagged" value={pending.count ?? 0} note="Waiting for your call" tone="amber" />
        <StatCard label="Filtered as spam" value={spam.count ?? 0} note="Blocked automatically" tone="dim" />
        <StatCard label="Issues tracked" value={(clusters ?? []).length} note="Clusters" tone="dim" />
      </section>

      <section className="panel space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="stat-label">Automation controls</div>
            <h2 className="h-section">Scheduled source scanner</h2>
            <p className="max-w-3xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              Vercel attempts the scheduled run daily at 09:00 UTC, which is 5:00 AM in Florida during daylight
              saving time. The website can pause/resume scheduled runs and start manual scans; changing the actual cron
              time still requires a deploy.
            </p>
          </div>
          <span className={automationControl.paused ? "badge badge-amber" : "badge badge-green"}>
            {automationControl.paused ? "scheduled scans stopped" : "scheduled scans on"}
          </span>
        </div>

        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="stat-label mb-1">Budget</div>
            <p className="text-lg font-semibold">${budget.toFixed(2)}</p>
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Monthly env guardrail
            </p>
          </div>
          <div>
            <div className="stat-label mb-1">Providers</div>
            <p>Reddit: {f.reddit ? "enabled" : "disabled"}</p>
            <p>Web search: {f.webSearch ? "enabled" : "disabled"}</p>
            <p style={f.turnstile ? undefined : { color: "var(--crimson-bright)" }}>
              Spam shield (Turnstile): {f.turnstile ? "enabled" : "OFF — report form has no captcha"}
            </p>
          </div>
          <div>
            <div className="stat-label mb-1">Latest run</div>
            {latestRun ? (
              <>
                <p>
                  {formatEasternDateTime(latestRun.started_at)} · {latestRun.status} · {latestRun.mode.replace("_", " ")}
                </p>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  {runSummary(latestRun)}
                </p>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  {latestMessages?.operatorSummary}
                </p>
              </>
            ) : (
              <p style={{ color: "var(--text-dim)" }}>No scanner run recorded yet.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <form action={runAutomationDryScan}>
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Scanning...">
              Test scan
            </SubmitButton>
          </form>
          <form action={runAutomationCappedScan}>
            <SubmitButton className="btn btn-sm" pendingText="Scanning...">
              Run capped scan
            </SubmitButton>
          </form>
          <form action={setAutomationPaused}>
            <input type="hidden" name="paused" value={automationControl.paused ? "false" : "true"} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving...">
              {automationControl.paused ? "Resume scheduled scans" : "Stop scheduled scans"}
            </SubmitButton>
          </form>
          <Link className="btn btn-ghost btn-sm" href="/admin/source-monitor">
            Full run ledger
          </Link>
        </div>
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
              Auto-moderation is handling everything. Nothing is waiting on you. Flagged reports show up here only when
              something looks ambiguous or sensitive.
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
                    {(clusters ?? []).map((cluster) => (
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

      <section className="panel">
        <div className="stat-label mb-3">Cluster fix-status</div>
        <div className="space-y-2">
          {(clusters ?? []).map((cluster) => (
            <form key={cluster.id} action={setClusterFixStatus} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="cluster_id" value={cluster.id} />
              <span className="min-w-0 flex-1 truncate">{cluster.title}</span>
              <FixStatusBadge status={cluster.fix_status} />
              <select name="fix_status" defaultValue={cluster.fix_status} className="w-52">
                {FIX_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…">
                Save
              </SubmitButton>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
