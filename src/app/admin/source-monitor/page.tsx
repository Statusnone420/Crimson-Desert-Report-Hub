import { runAutomationCappedScan, runAutomationDryScan, setAutomationPaused } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "not finished";
  return new Date(iso).toLocaleString();
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

function messageList(messages: string[]): string {
  return messages.length > 0 ? messages.join(", ") : "none";
}

export default async function SourceMonitorPage() {
  await requireAdmin();
  const f = features();
  const budget = automationBudgetUsd();
  const { runs, signals, control } = await getAutomationAdminData();

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
              Scanner setting changed {formatDateTime(control.updatedAt)}.
            </p>
          ) : null}
        </div>

        <div className="panel overflow-x-auto">
          <div className="stat-label mb-2">Latest automation runs</div>
          {runs.length > 0 ? (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead style={{ color: "var(--text-dim)" }}>
                <tr>
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Mode</th>
                  <th className="py-2 pr-3 font-medium">Est. spend</th>
                  <th className="py-2 pr-3 font-medium">Work</th>
                  <th className="py-2 font-medium">Skips / errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pr-3">{formatDateTime(run.started_at)}</td>
                    <td className="py-2 pr-3">
                      <span className={statusClass(run.status)}>{run.status}</span>
                    </td>
                    <td className="py-2 pr-3">{run.mode.replace("_", " ")}</td>
                    <td className="py-2 pr-3">{formatUsd(run.estimated_cost_usd)}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--text-dim)" }}>
                      {workSummary(run)}
                    </td>
                    <td className="py-2" style={{ color: "var(--text-dim)" }}>
                      skips: {messageList(run.skips)}
                      <br />
                      errors: {messageList(run.errors)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}
