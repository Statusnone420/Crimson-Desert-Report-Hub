import {
  rescueRejectedCandidate,
  runAutomationCappedScan,
  runAutomationDryScan,
  setAutomationPaused,
} from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { CATEGORY_LABELS } from "@/lib/constants";
import { automationBudgetUsd, features } from "@/lib/env";
import { requireAdmin } from "@/lib/adminGuard";
import { getAutomationAdminData } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RunWork = {
  mode: string;
  search_queries_used: number;
  llm_calls_used: number;
  signals_inserted: number;
  signals_deduped: number;
  clusters_promoted: number;
};

function workSummary(run: RunWork): string {
  const base = `${run.search_queries_used} searches · ${run.llm_calls_used} LLM`;
  if (run.mode === "dry_run") {
    // A dry run writes nothing to the database except this ledger row.
    return `${base} · ${run.signals_inserted} would insert · ${run.signals_deduped} deduped · preview only, nothing saved`;
  }
  return `${base} · ${run.signals_inserted} inserted · ${run.signals_deduped} deduped · ${run.clusters_promoted} promoted`;
}

function funnelSummary(funnel: Record<string, number> | null): string | null {
  if (!funnel) return null;
  const { candidatesSeen, deduped, prefilterRejected, llmCalls, kept, promoted } = funnel;
  if (
    candidatesSeen === undefined ||
    deduped === undefined ||
    prefilterRejected === undefined ||
    llmCalls === undefined ||
    kept === undefined ||
    promoted === undefined
  ) {
    return null;
  }
  return `${candidatesSeen} seen → ${deduped} deduped → ${prefilterRejected} pre-filtered → ${llmCalls} LLM → ${kept} kept → ${promoted} promoted`;
}

function formatUsd(value: number): string {
  return `$${Number(value).toFixed(3)}`;
}

function statusClass(status: string): string {
  if (status === "public" || status === "success") return "badge badge-green";
  if (status === "hidden" || status === "failed") return "badge badge-crimson";
  if (status === "partial") return "badge badge-amber";
  return "badge badge-dim";
}

export default async function SourceMonitorPage() {
  await requireAdmin();
  const f = features();
  const budget = automationBudgetUsd();
  const { runs, signals, rejectedCandidates, control } = await getAutomationAdminData();

  return (
    <div className="space-y-6">
      <section>
        <p className="stat-label">Admin evidence intake</p>
        <h1 className="h-display">Source monitor</h1>
      </section>

      <section className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="stat-label">Scanner status</div>
              <div className="stat-value">{control.paused ? "Paused" : "Active"}</div>
            </div>
            <span className={control.paused ? "badge badge-amber" : "badge badge-green"}>
              {control.paused ? "scheduled scans off" : "scheduled scans on"}
            </span>
          </div>
          <div className="stat-label">Monthly automation budget</div>
          <div className="text-xl font-semibold">${budget.toFixed(2)}</div>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Reddit: {f.reddit ? "enabled" : "disabled"} · Web search: {f.webSearch ? "enabled" : "disabled"}
          </p>
          <div className="panel-inset border p-3 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
            <div className="stat-label mb-1">Scheduled cadence</div>
            Vercel cron attempts a scheduled scan daily at 09:00 UTC, which is 5:00 AM in Florida during daylight
            saving time. It skips automation when any run started in the previous 6 hours.
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={runAutomationDryScan}>
              <SubmitButton className="btn btn-ghost" pendingText="Scanning… up to ~2 min">
                Test scan without publishing
              </SubmitButton>
            </form>
            <form action={runAutomationCappedScan}>
              <SubmitButton className="btn" pendingText="Scanning… up to ~2 min">
                Run capped scan now
              </SubmitButton>
            </form>
            <form action={setAutomationPaused}>
              <input type="hidden" name="paused" value={control.paused ? "false" : "true"} />
              <SubmitButton className="btn btn-ghost" pendingText="Saving…">
                {control.paused ? "Resume scheduled scans" : "Pause scheduled scans"}
              </SubmitButton>
            </form>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            A scan runs several web searches and AI calls one at a time, so it can take 1–2 minutes — the button shows
            &quot;Scanning…&quot; while it works. Test scans write only the run ledger (nothing public changes). Capped scans use the
            monthly budget guardrail and promote only qualifying public signals. Pause affects scheduled scans only; manual
            runs still work.
          </p>
          {control.updatedAt ? (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Scanner setting changed {formatEasternDateTime(control.updatedAt)}.
            </p>
          ) : null}
        </div>

        <div className="panel">
          <div className="stat-label mb-2">Latest automation runs</div>
          {runs.length > 0 ? (
            <div className="space-y-3">
              {runs.map((run) => {
                const messages = summarizeRunMessages(run.skips, run.errors);
                return (
                  <article key={run.id} className="panel-inset space-y-3 border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="stat-label">Started</div>
                        <div>{formatEasternDateTime(run.started_at)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusClass(run.status)}>{run.status}</span>
                        <span className="badge badge-dim">{run.mode.replace("_", " ")}</span>
                        <span className="badge badge-dim">{formatUsd(run.estimated_cost_usd)} est.</span>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
                      <div>
                        <div className="stat-label mb-1">Work</div>
                        <p style={{ color: "var(--text-dim)" }}>{workSummary(run)}</p>
                      </div>
                      <div>
                        <div className="stat-label mb-1">Operator readout</div>
                        <p style={{ color: "var(--text-dim)" }}>{messages.operatorSummary}</p>
                        <p className="mt-1 text-xs" style={{ color: run.errors.length > 0 ? "var(--crimson-bright)" : "var(--text-faint)" }}>
                          {messages.errorSummary}
                        </p>
                      </div>
                    </div>

                    {funnelSummary(run.funnel) ? (
                      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {funnelSummary(run.funnel)}
                      </p>
                    ) : null}

                    {messages.skipGroups.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {messages.skipGroups.map((group) => (
                          <span key={group.code} className="chip" title={group.detail}>
                            <span className="num">{group.count}</span>
                            {group.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <details className="text-xs" style={{ color: "var(--text-faint)" }}>
                      <summary className="cursor-pointer">Raw scanner codes</summary>
                      <p className="mt-2 break-words">skips: {run.skips.length > 0 ? run.skips.join(", ") : "none"}</p>
                      <p className="mt-1 break-words">errors: {run.errors.length > 0 ? run.errors.join(", ") : "none"}</p>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              No automation runs yet.
            </p>
          )}
          <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
            &quot;Est. spend&quot; is estimated from a fixed per-search rate for budget tracking — it is not a real charge. On the
            free Tavily and OpenRouter tiers your actual dollar cost is $0.
          </p>
        </div>
      </section>

      <div className="panel">
        <div className="stat-label mb-2">Recent signals ({signals.length})</div>
        {signals.map((signal) => (
          <div key={signal.id} className="border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span className={statusClass(signal.public_status)}>{signal.public_status}</span>
              <span className="badge badge-dim">{signal.source_type ?? signal.source}</span>
              <span className="badge badge-dim">
                {CATEGORY_LABELS[signal.category as keyof typeof CATEGORY_LABELS] ?? signal.category}
              </span>
              <span>{signal.confidence} confidence</span>
              <span>{new Date(signal.observed_at).toLocaleString()}</span>
            </div>
            {signal.title ? <p className="mt-1 font-medium">{signal.title}</p> : null}
            <p className="mt-1">{signal.summary}</p>
            <a
              href={signal.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-xs"
              style={{ color: "var(--blue)" }}
            >
              {signal.source_url}
            </a>
          </div>
        ))}
        {signals.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No signals yet.
          </p>
        ) : null}
      </div>

      <div className="panel">
        <div className="stat-label mb-2">Rejected candidates (last 7 days)</div>
        {rejectedCandidates.map((candidate) => (
          <div
            key={candidate.id}
            className="border-b py-2 text-sm last:border-0"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span className="chip">{candidate.reason.replace(/_/g, " ")}</span>
              {candidate.source_domain ? <span className="badge badge-dim">{candidate.source_domain}</span> : null}
              <span>{formatEasternDateTime(candidate.created_at)}</span>
            </div>
            <p className="mt-1 font-medium">{candidate.title}</p>
            <a
              href={candidate.url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-xs"
              style={{ color: "var(--blue)" }}
            >
              {candidate.url}
            </a>
            <div className="mt-2">
              {candidate.rescued_at ? (
                <span className="badge badge-green">rescued</span>
              ) : (
                <form action={rescueRejectedCandidate}>
                  <input type="hidden" name="id" value={candidate.id} />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="Rescuing…">
                    Rescue
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        ))}
        {rejectedCandidates.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No rejected candidates in the last 7 days.
          </p>
        ) : null}
      </div>
    </div>
  );
}
