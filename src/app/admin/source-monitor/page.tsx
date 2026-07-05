import { runAutomationCappedScan, runAutomationDryScan } from "@/app/admin/actions";
import { CATEGORY_LABELS } from "@/lib/constants";
import { automationBudgetUsd, features } from "@/lib/env";
import { requireAdmin } from "@/lib/adminGuard";
import { getAutomationAdminData } from "@/lib/queries";

export const dynamic = "force-dynamic";

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
  const { runs, signals } = await getAutomationAdminData();

  return (
    <div className="space-y-6">
      <section>
        <p className="stat-label">Admin evidence intake</p>
        <h1 className="text-3xl font-semibold tracking-tight">Source monitor</h1>
      </section>

      <section className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel space-y-3">
          <div className="stat-label">Monthly automation budget</div>
          <div className="stat-value">${budget.toFixed(2)}</div>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Reddit: {f.reddit ? "enabled" : "disabled"} · Web search: {f.webSearch ? "enabled" : "disabled"}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={runAutomationDryScan}>
              <button className="btn btn-ghost">Run dry scan</button>
            </form>
            <form action={runAutomationCappedScan}>
              <button className="btn">Run capped scan now</button>
            </form>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Dry scans write only the run ledger. Capped scans use the monthly budget guardrail and promote only qualifying
            public signals.
          </p>
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
                  <th className="py-2 pr-3 font-medium">Cost</th>
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
                      {run.search_queries_used} searches · {run.llm_calls_used} LLM · {run.signals_inserted} inserted ·{" "}
                      {run.signals_deduped} deduped · {run.clusters_promoted} promoted
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
              className="text-xs"
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
