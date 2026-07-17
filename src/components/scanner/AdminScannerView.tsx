import { setScannerPolicy } from "@/app/admin/actions";
import { ScanControls } from "@/components/ScanControls";
import { RejectedArchive } from "@/components/scanner/RejectedArchive";
import { SubmitButton } from "@/components/SubmitButton";
import type { Features, IntegrationStatus } from "@/lib/env";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import type { AutomationControlState } from "@/lib/automation/settings";
import { radarYieldPct } from "@/lib/observatoryMetrics";
import type { AdminSignalRow, AutomationRunRow, PublicScannerData, RejectedCandidateRow } from "@/lib/queries";

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

function scannerStatus(
  control: AutomationControlState,
  activeRun: { id: string } | null,
  lastScheduled: { status: string; skips: string[] } | null,
): { label: string; toneClass: string } {
  if (activeRun) return { label: "RUNNING", toneClass: "is-amber" };
  if (control.paused) return { label: "PAUSED", toneClass: "is-amber" };
  if (runHasCapSkip(lastScheduled)) return { label: "CAPPED", toneClass: "is-crimson" };
  return { label: "ACTIVE", toneClass: "is-green" };
}

function formatUsd(value: number): string {
  return `$${Number(value).toFixed(2)}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "not scheduled";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const abs = Math.abs(mins);
  const prefix = mins < 0 ? "in " : "";
  const suffix = mins < 0 ? "" : " ago";
  if (abs < 1) return mins < 0 ? "in less than a minute" : "just now";
  if (abs < 60) return `${prefix}${abs}m${suffix}`;
  const hours = Math.floor(abs / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${Math.floor(hours / 24)}d${suffix}`;
}

function funnelSummary(funnel: Record<string, number> | null): string | null {
  if (!funnel) return null;
  const { searchResultsSeen, candidatesSeen, deduped, prefilterRejected, llmEligible, llmCalls, kept, promoted } = funnel;
  if ([candidatesSeen, deduped, prefilterRejected, llmEligible, llmCalls, kept, promoted].some((v) => v === undefined)) {
    return null;
  }
  const results = searchResultsSeen === undefined ? "" : `${searchResultsSeen} results -> `;
  return `${results}${candidatesSeen} screened -> ${deduped} deduped -> ${prefilterRejected} pre-filtered -> ${llmEligible} LLM-eligible -> ${llmCalls} LLM -> ${kept} kept -> ${promoted} promoted`;
}

function plainRunLine(run: AutomationRunRow): string {
  if (run.status === "skipped") {
    return summarizeRunMessages(run.skips, run.errors).operatorSummary;
  }
  if (run.status === "failed") {
    return `Scan failed - ${summarizeRunMessages(run.skips, run.errors).errorSummary}`;
  }
  if (run.search_results_seen + run.reddit_posts_seen === 0) {
    return run.errors.length > 0
      ? `No sources reviewed - ${summarizeRunMessages(run.skips, run.errors).errorSummary}`
      : "Ran, nothing new";
  }
  const found = run.search_results_seen + run.reddit_posts_seen;
  const kept = run.signals_inserted;
  const parts = [`Found ${found}, kept ${kept}`];
  if (run.signals_reobserved > 0) parts.push(`re-observed ${run.signals_reobserved}`);
  if (run.candidates_rescued > 0) parts.push(`kept for review ${run.candidates_rescued}`);
  if (run.clusters_promoted > 0) parts.push(`published ${run.clusters_promoted}`);
  const line = parts.join(", ");
  return run.errors.length > 0 ? `${line} (with errors)` : line;
}

function sourceHost(signal: AdminSignalRow): string {
  if (signal.source_domain) return signal.source_domain;
  try {
    return new URL(signal.source_url).hostname.replace(/^www\./, "");
  } catch {
    return signal.source;
  }
}

function publicStatusLabel(status: AdminSignalRow["public_status"]): string {
  if (status === "public") return "PUBLIC";
  if (status === "hidden") return "HIDDEN";
  return "PRIVATE";
}

function confidenceTone(confidence: AdminSignalRow["confidence"]): string {
  if (confidence === "high") return "is-green";
  if (confidence === "medium") return "is-amber";
  return "";
}

function signalRow(signal: AdminSignalRow) {
  return (
    <article key={signal.id} className="lead-item">
      <div className="lead-item__status">
        <span className={signal.public_status === "public" ? "is-green" : undefined}>
          {publicStatusLabel(signal.public_status)}
        </span>{" "}
        · {(signal.source_type ?? signal.source).toUpperCase()} ·{" "}
        <span className={confidenceTone(signal.confidence)}>{signal.confidence.toUpperCase()} CONFIDENCE</span> · SEEN{" "}
        {signal.seen_count ?? 1}×
      </div>
      <h3 className="lead-item__title">{signal.title ?? "Untitled source lead"}</h3>
      <p className="lead-item__summary">{signal.summary}</p>
      <div className="lead-item__meta">
        {sourceHost(signal)} · LAST SEEN {relativeTime(signal.observed_at)} ·{" "}
        <a href={signal.source_url} target="_blank" rel="noreferrer noopener" className="dispatch-link">
          Open source
        </a>
      </div>
    </article>
  );
}

export function AdminScannerView({
  runs,
  signals,
  rejectedCandidates,
  control,
  activeRun,
  latestRealRun,
  latestFind,
  scoreboard,
  features,
  integrations,
}: {
  runs: AutomationRunRow[];
  signals: AdminSignalRow[];
  rejectedCandidates: RejectedCandidateRow[];
  control: AutomationControlState;
  activeRun: { id: string } | null;
  latestRealRun: AutomationRunRow | null;
  latestFind: AutomationRunRow | null;
  scoreboard: PublicScannerData;
  features: Features;
  integrations: IntegrationStatus[];
}) {
  const now = new Date();
  const lastScheduled = runs.find((run) => run.mode === "scheduled") ?? null;
  const nextEligible = nextEligibleScheduledScanAt(runs, now, control.minIntervalMinutes);
  const status = scannerStatus(control, activeRun, lastScheduled);
  const projectedCredits = projectedMonthlyCredits(control);
  const latestRun = latestRealRun;
  const redditOff = !features.reddit;
  const rejectedArchive = rejectedCandidates.filter((candidate) => !candidate.rescued_at);
  const recentSignals = signals.slice(0, 6);
  const pausedIntegrations = integrations.filter((integration) => integration.paused);
  const yieldPct = radarYieldPct(scoreboard.keptThisWeek, scoreboard.reviewedThisWeek);

  return (
    <>
      <header className="dispatch-pagehead" style={{ paddingBottom: 30 }}>
        <div className="dispatch-pagehead__copy">
          <p className="dispatch-kicker dispatch-kicker--amber">Operator · The Observatory</p>
          <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
            Scanner monitor
          </h1>
          <p className="dispatch-pagehead__dek" style={{ maxWidth: "54ch" }}>
            Source health, kept radar leads, and an expiring archive of auto-rejected candidates.
          </p>
        </div>
        <div className="op-actions">
          <ScanControls activeRunId={activeRun?.id ?? null} />
        </div>
      </header>

      <div className="op-status-line">
        <span className={status.toneClass}>● {status.label}</span>
        {" · "}
        {latestRun ? `LAST SCAN ${relativeTime(latestRun.started_at)}` : "NO COMPLETED SCAN YET"}
        {" · "}
        {control.paused ? "NEXT CHECK PAUSED" : `NEXT CHECK ${relativeTime(nextEligible.toISOString())}`}
        {latestFind ? ` · MOST RECENT KEPT LEAD ${relativeTime(latestFind.started_at)}` : ""}
        {redditOff ? (
          <>
            {" · "}
            <span className="is-amber">REDDIT API OFF</span>
          </>
        ) : null}
        {pausedIntegrations.map((integration) => (
          <span key={integration.key}>
            {" · "}
            <span className="is-amber">{integration.label.toUpperCase()} PAUSED</span>
          </span>
        ))}
      </div>

      <div className="stat-band" aria-label="Source radar funnel">
        <div className="stat-band__cell">
          <div className="stat-band__label">Reviewed · 7d</div>
          <div className="stat-band__value">{scoreboard.reviewedThisWeek}</div>
        </div>
        <div className="stat-band__cell">
          <div className="stat-band__label">Filtered</div>
          <div className="stat-band__value">{scoreboard.filteredThisWeek}</div>
        </div>
        <div className="stat-band__cell">
          <div className="stat-band__label">Awaiting corroboration</div>
          <div className="stat-band__value stat-band__value--blue">{scoreboard.awaiting}</div>
        </div>
        <div className="stat-band__cell">
          <div className="stat-band__label">Published issues</div>
          <div className="stat-band__value stat-band__value--crimson">{scoreboard.published}</div>
        </div>
        <div className="stat-band__cell">
          <div className="stat-band__label">
            Live {scoreboard.published} · Watching {scoreboard.awaiting} · Kept {scoreboard.keptThisWeek}
          </div>
          <div className="stat-band__value">{scoreboard.reviewedThisWeek > 0 ? `${yieldPct.toFixed(1)}%` : "0%"}</div>
          <div className="stat-band__caption">radar yield</div>
        </div>
      </div>

      <div className="monitor-grid">
        <section className="monitor-col" aria-label="Recent radar leads">
          <div className="monitor-col__header">
            <h2 className="mono-label">Recent radar leads</h2>
            <span className="mono-label">{signals.length} recent</span>
          </div>
          {recentSignals.length > 0 ? (
            recentSignals.map((signal) => signalRow(signal))
          ) : (
            <p className="op-note">No kept source leads yet.</p>
          )}
        </section>

        <section className="monitor-col" aria-label="Rejected archive">
          <div className="monitor-col__header">
            <h2 className="mono-label">Rejected archive</h2>
            <span className={rejectedArchive.length > 0 ? "mono-label mono-label--amber" : "mono-label"}>
              {rejectedArchive.length} expiring
            </span>
          </div>
          <p className="op-note" style={{ marginBottom: 14 }}>
            The 30 most recent auto-rejected candidates, held briefly in case one was real. They expire on their
            own — rescuing is optional, not homework.
          </p>
          {rejectedArchive.length > 0 ? (
            <RejectedArchive candidates={rejectedArchive} />
          ) : (
            <p className="op-note">Nothing rejected recently — the filter had a quiet week.</p>
          )}
        </section>

        <aside className="monitor-col" aria-label="Latest run">
          <div className="op-rail-block">
            <h2 className="mono-label" style={{ display: "block", marginBottom: 14 }}>
              Latest run
            </h2>
            {latestRun ? (
              <p
                className="op-rail__sentence"
                style={latestRun.status === "failed" ? { color: "var(--crimson)" } : undefined}
              >
                {plainRunLine(latestRun)}.
              </p>
            ) : (
              <p className="op-rail__sentence">No completed scan yet.</p>
            )}
          </div>
          {latestRun ? (
            <>
              <div className="op-rail-block">
                <div className="mono-label" style={{ marginBottom: 6 }}>
                  Work
                </div>
                <p className="op-rail__mono">
                  {latestRun.search_queries_used} Tavily credits ·{" "}
                  {latestRun.search_results_seen + latestRun.reddit_posts_seen} candidates · {latestRun.llm_calls_used}{" "}
                  LLM
                </p>
              </div>
              <div className="op-rail-block">
                <div className="mono-label" style={{ marginBottom: 6 }}>
                  Operator readout
                </div>
                <p className="op-rail__readout">
                  {summarizeRunMessages(latestRun.skips, latestRun.errors).operatorSummary}
                </p>
              </div>
            </>
          ) : null}
          <div className="op-rail-block op-rail__links">
            <details>
              <summary>Scan history →</summary>
              <div style={{ marginTop: 10 }}>
                {runs.slice(0, 8).map((run) => (
                  <div key={run.id} className="op-history-row">
                    <span className="num-quiet">
                      {formatEasternDateTime(run.started_at).replace(/^[A-Za-z]+ \d+, \d+, /, "")}
                    </span>
                    <span
                      style={{
                        color:
                          run.search_results_seen > 0 && run.status !== "skipped"
                            ? "var(--dispatch-ink)"
                            : "var(--dispatch-faint)",
                      }}
                    >
                      {plainRunLine(run)}
                    </span>
                    <span className="num-quiet">{formatUsd(run.estimated_cost_usd)}</span>
                  </div>
                ))}
                <details className="mt-2 text-xs" style={{ color: "var(--dispatch-faint)" }}>
                  <summary className="cursor-pointer">Show raw scanner codes (funnel, skips, errors)</summary>
                  <div className="mt-2 space-y-2">
                    {runs.slice(0, 8).map((run) => (
                      <div key={run.id} className="break-words">
                        <span style={{ fontFamily: "var(--font-mono)" }}>{formatEasternDateTime(run.started_at)}</span>
                        {funnelSummary(run.funnel) ? <span> · {funnelSummary(run.funnel)}</span> : null}
                        {run.skips.length > 0 ? <span> · skips: {run.skips.join(", ")}</span> : null}
                        {run.errors.length > 0 ? <span> · errors: {run.errors.join(", ")}</span> : null}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </details>
            <details>
              <summary>Scanner settings &amp; budget →</summary>
              <form action={setScannerPolicy} className="space-y-3 text-sm" style={{ marginTop: 12 }}>
                <input type="hidden" name="minIntervalMinutes" value={control.minIntervalMinutes} />
                <input type="hidden" name="modelPreset" value={control.modelPreset} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="dispatch-field grid gap-1">
                    <span className="mono-label">How often</span>
                    <select name="cadence" defaultValue={control.paused ? "paused" : String(control.minIntervalMinutes)}>
                      <option value="60">Hourly</option>
                      <option value="120">Every 2 hours</option>
                      <option value="360">Every 6 hours</option>
                      <option value="1440">Daily</option>
                      <option value="paused">Paused</option>
                    </select>
                  </label>
                  <label className="dispatch-field grid gap-1">
                    <span className="mono-label">Search depth</span>
                    <select
                      name="scheduledSearchCreditsPerRun"
                      defaultValue={String(control.scheduledSearchCreditsPerRun)}
                    >
                      <option value="1">1 search / run</option>
                      <option value="2">2 searches / run</option>
                      <option value="3">3 searches / run</option>
                    </select>
                  </label>
                  <label className="dispatch-field grid gap-1">
                    <span className="mono-label">Monthly search cap</span>
                    <input
                      name="monthlyTavilyCreditCap"
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      defaultValue={control.monthlyTavilyCreditCap}
                    />
                  </label>
                  <label className="dispatch-field grid gap-1">
                    <span className="mono-label">Monthly LLM cap ($)</span>
                    <input
                      name="monthlyLlmUsdCap"
                      type="number"
                      min="0"
                      max="2"
                      step="0.25"
                      defaultValue={control.monthlyLlmUsdCap}
                    />
                  </label>
                </div>
                <p className="op-note">
                  {`At this setting the base searches use about ${projectedCredits} monthly Tavily credits; bounded old-Reddit context reads can use some of the remaining allowance, and all discovery stops at ${control.monthlyTavilyCreditCap}. DeepSeek V4 Flash stops at $${control.monthlyLlmUsdCap.toFixed(2)} per month. Cadence is ${cadenceLabel(control.minIntervalMinutes)}. Test scans never touch the public site.`}
                </p>
                <SubmitButton className="dispatch-btn" pendingText="Saving...">
                  Save settings
                </SubmitButton>
              </form>
            </details>
          </div>
        </aside>
      </div>
    </>
  );
}
