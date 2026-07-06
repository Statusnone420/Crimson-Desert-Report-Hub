import { rescueRejectedCandidate, setScannerPolicy } from "@/app/admin/actions";
import { ScanControls } from "@/components/ScanControls";
import { SubmitButton } from "@/components/SubmitButton";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import type { AutomationControlState } from "@/lib/automation/settings";
import { CATEGORY_LABELS } from "@/lib/constants";
import { features } from "@/lib/env";
import { requireAdmin } from "@/lib/adminGuard";
import { getAutomationAdminData } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RunWork = {
  mode: string;
  status: string;
  intent: string | null;
  search_queries_used: number;
  search_results_seen: number;
  llm_calls_used: number;
  signals_inserted: number;
  signals_deduped: number;
  signals_reobserved: number;
  stale_signals_hidden: number;
  candidates_rescued: number;
  clusters_promoted: number;
};

function workSummary(run: RunWork): string {
  if (run.status === "skipped") return "no scan started — see operator readout";
  const base = `${run.search_queries_used} searches · ${run.search_results_seen} results · ${run.llm_calls_used} LLM`;
  if (run.mode === "dry_run") {
    // A dry run writes nothing to the database except this ledger row.
    return `${base} · ${run.signals_inserted} would insert · ${run.signals_deduped} deduped · preview only, nothing saved`;
  }
  const outcomes = [
    run.signals_inserted > 0 ? `${run.signals_inserted} kept` : "no new public evidence",
    `${run.signals_deduped} deduped`,
  ];
  if (run.signals_reobserved > 0) outcomes.push(`${run.signals_reobserved} re-observed`);
  if (run.stale_signals_hidden > 0) outcomes.push(`${run.stale_signals_hidden} stale hidden`);
  if (run.candidates_rescued > 0) outcomes.push(`${run.candidates_rescued} rescued`);
  if (run.clusters_promoted > 0) outcomes.push(`${run.clusters_promoted} promoted`);
  return `${base} · ${outcomes.join(" · ")}`;
}

function funnelSummary(funnel: Record<string, number> | null): string | null {
  if (!funnel) return null;
  const { searchResultsSeen, candidatesSeen, deduped, prefilterRejected, llmEligible, llmCalls, kept, promoted } = funnel;
  if (
    candidatesSeen === undefined ||
    deduped === undefined ||
    prefilterRejected === undefined ||
    llmEligible === undefined ||
    llmCalls === undefined ||
    kept === undefined ||
    promoted === undefined
  ) {
    return null;
  }
  const results = searchResultsSeen === undefined ? "" : `${searchResultsSeen} results → `;
  return `${results}${candidatesSeen} screened → ${deduped} deduped → ${prefilterRejected} pre-filtered → ${llmEligible} LLM-eligible → ${llmCalls} LLM → ${kept} kept → ${promoted} promoted`;
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

function cadenceLabel(minutes: number): string {
  if (minutes === 60) return "hourly";
  if (minutes === 120) return "every 2 hours";
  if (minutes === 360) return "every 6 hours";
  return "daily";
}

function projectedMonthlyCredits(control: AutomationControlState): number {
  if (control.paused) return 0;
  return Math.ceil((30 * 24 * 60 * control.scheduledSearchCreditsPerRun) / control.minIntervalMinutes);
}

function runHasCapSkip(run: { status: string; skips: string[] } | null): boolean {
  return Boolean(
    run?.status === "skipped" &&
      run.skips.some((skip) => skip.includes("tavily_credit_cap") || skip.includes("llm_budget_capped")),
  );
}

function intentLabel(intent: string | null): string {
  if (!intent) return "discovery";
  return intent.replace(/_/g, " ");
}

function scannerStatus(
  control: AutomationControlState,
  activeRun: { id: string } | null,
  lastScheduled: { status: string; skips: string[] } | null,
) {
  if (activeRun) return { label: "Running", className: "badge badge-amber" };
  if (control.paused) return { label: "Paused", className: "badge badge-amber" };
  if (runHasCapSkip(lastScheduled)) return { label: "Capped", className: "badge badge-crimson" };
  return { label: "Active", className: "badge badge-green" };
}

export default async function SourceMonitorPage() {
  await requireAdmin();
  const f = features();
  const { runs, signals, rejectedCandidates, control, activeRun } = await getAutomationAdminData();
  const now = new Date();
  const lastScheduled = runs.find((run) => run.mode === "scheduled") ?? null;
  const nextEligible = nextEligibleScheduledScanAt(runs, now, control.minIntervalMinutes);
  const status = scannerStatus(control, activeRun, lastScheduled);
  const projectedCredits = projectedMonthlyCredits(control);

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
              <div className="stat-value">{status.label}</div>
            </div>
            <span className={status.className}>{status.label.toLowerCase()}</span>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="panel-inset border p-3">
              <div className="stat-label mb-1">Cadence</div>
              <p className="font-semibold">{control.paused ? "paused" : cadenceLabel(control.minIntervalMinutes)}</p>
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Cloudflare wakes hourly; policy skips when too soon.
              </p>
            </div>
            <div className="panel-inset border p-3">
              <div className="stat-label mb-1">Budget caps</div>
              <p className="font-semibold">
                {control.monthlyTavilyCreditCap} Tavily · ${control.monthlyLlmUsdCap} LLM
              </p>
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Estimated spend; caps stop scheduled work.
              </p>
            </div>
          </div>

          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Reddit: {f.reddit ? "enabled" : "disabled"} · Web search: {f.webSearch ? "enabled" : "disabled"}
          </p>

          <form action={setScannerPolicy} className="panel-inset space-y-3 border p-3 text-sm">
            <input type="hidden" name="minIntervalMinutes" value={control.minIntervalMinutes} />
            <input type="hidden" name="modelPreset" value={control.modelPreset} />
            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="stat-label">Cadence</span>
                <select name="cadence" defaultValue={control.paused ? "paused" : String(control.minIntervalMinutes)}>
                  <option value="60">Hourly</option>
                  <option value="120">Every 2 hours</option>
                  <option value="360">Every 6 hours</option>
                  <option value="1440">Daily</option>
                  <option value="paused">Paused</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="stat-label">Search volume</span>
                <select name="scheduledSearchCreditsPerRun" defaultValue={String(control.scheduledSearchCreditsPerRun)}>
                  <option value="1">1 Tavily credit/run</option>
                  <option value="2">2 Tavily credits/run</option>
                  <option value="3">3 Tavily credits/run</option>
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="stat-label">Monthly Tavily cap</span>
                  <input
                    name="monthlyTavilyCreditCap"
                    type="number"
                    min="0"
                    max="900"
                    step="1"
                    defaultValue={control.monthlyTavilyCreditCap}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="stat-label">Monthly LLM cap</span>
                  <input
                    name="monthlyLlmUsdCap"
                    type="number"
                    min="1"
                    max="5"
                    step="0.25"
                    defaultValue={control.monthlyLlmUsdCap}
                  />
                </label>
              </div>
            </div>

            <div className="panel-inset border p-3 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
              <p>
                Current setting projects about <span className="num">{projectedCredits}</span> Tavily credits/month
                before policy skips, against a <span className="num">{control.monthlyTavilyCreditCap}</span> credit cap.
                This scanner policy is hard-capped at <span className="num">900</span> to leave free-tier buffer.
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer">Advanced route</summary>
                <p className="mt-1">
                  <span className="num">DeepSeek Flash → Qwen → DeepSeek Pro</span>
                </p>
              </details>
            </div>

            <SubmitButton className="btn" pendingText="Saving policy…">
              Save scanner policy
            </SubmitButton>
          </form>

          <div className="panel-inset border p-3 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
            <div className="stat-label mb-1">Scheduled attempts</div>
            <p>
              Every scheduled attempt writes a run ledger row. Skips are plain policy reasons: paused, too recent,
              already running, Tavily capped, or LLM capped.
            </p>
            <p className="mt-1">
              Next eligible run:{" "}
              <span className="num">
                {control.paused ? "paused until resumed" : formatEasternDateTime(nextEligible.toISOString())}
              </span>
            </p>
            <p className="mt-1">
              Last attempt:{" "}
              {lastScheduled
                ? `${formatEasternDateTime(lastScheduled.started_at)} — ${
                    lastScheduled.status === "skipped"
                      ? summarizeRunMessages(lastScheduled.skips, []).operatorSummary
                      : lastScheduled.status
                  }`
                : "none recorded yet"}
            </p>
          </div>
          <ScanControls activeRunId={activeRun?.id ?? null} />
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            A scan runs in the background — the card above updates itself every few seconds and the rest of the site
            stays usable. Test scans write only the run ledger (nothing public changes). Scheduled scans promote only
            qualifying public signals. Paused policy affects scheduled scans only; manual runs still work.
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
                        <span className="badge badge-dim">{intentLabel(run.intent)}</span>
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
              {signal.seen_count ? <span>seen {signal.seen_count}x</span> : null}
            </div>
            {signal.title ? <p className="mt-1 font-medium">{signal.title}</p> : null}
            <p className="mt-1">{signal.summary}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              {signal.source_published_at ? `Published ${formatEasternDateTime(signal.source_published_at)} · ` : ""}
              {signal.last_seen_at ? `Last seen ${formatEasternDateTime(signal.last_seen_at)}` : "Last seen not stored"}
            </p>
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
              {candidate.source_published_at ? <span>Published {formatEasternDateTime(candidate.source_published_at)}</span> : null}
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
