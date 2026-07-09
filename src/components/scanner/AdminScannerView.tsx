import { rescueRejectedCandidate, setScannerPolicy } from "@/app/admin/actions";
import { ScanControls } from "@/components/ScanControls";
import { SourceRadar } from "@/components/scanner/SourceRadar";
import { SubmitButton } from "@/components/SubmitButton";
import { SignalConfidenceBadge } from "@/components/ui";
import type { Features, IntegrationStatus } from "@/lib/env";
import { formatEasternDateTime, plainSkipPhrase, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import type { AutomationControlState } from "@/lib/automation/settings";
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
): { label: string; className: string } {
  if (activeRun) return { label: "Running", className: "badge badge-amber badge-dot" };
  if (control.paused) return { label: "Paused", className: "badge badge-amber badge-dot" };
  if (runHasCapSkip(lastScheduled)) return { label: "Capped", className: "badge badge-crimson badge-dot" };
  return { label: "Active", className: "badge badge-green badge-dot" };
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
  if (run.signals_reobserved > 0) parts.push(`re-confirmed ${run.signals_reobserved}`);
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
  if (status === "public") return "Public";
  if (status === "hidden") return "Hidden";
  return "Private";
}

function SignalRow({ signal }: { signal: AdminSignalRow }) {
  return (
    <article className="border-b py-3 last:border-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={signal.public_status === "public" ? "badge badge-green" : "badge badge-dim"}>
          {publicStatusLabel(signal.public_status)}
        </span>
        <span className="badge badge-dim">{signal.source_type ?? signal.source}</span>
        <SignalConfidenceBadge confidence={signal.confidence} />
        <span className="num" style={{ color: "var(--text-faint)" }}>
          seen {signal.seen_count ?? 1}x
        </span>
      </div>
      <h3 className="mt-2 text-sm font-semibold">{signal.title ?? "Untitled source signal"}</h3>
      <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
        {signal.summary}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="num" style={{ color: "var(--text-faint)" }}>
          {sourceHost(signal)}
        </span>
        <span className="num" style={{ color: "var(--text-faint)" }}>
          last seen {relativeTime(signal.observed_at)}
        </span>
        <a href={signal.source_url} target="_blank" rel="noreferrer noopener" className="link">
          Open source
        </a>
      </div>
    </article>
  );
}

function ReviewCandidate({ candidate }: { candidate: RejectedCandidateRow }) {
  return (
    <div className="border-b py-3 last:border-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{candidate.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {candidate.source_domain ? (
              <span className="num" style={{ color: "var(--text-faint)" }}>
                {candidate.source_domain}
              </span>
            ) : null}
            <span style={{ color: "var(--text-dim)" }}>{plainSkipPhrase(candidate.reason)}</span>
            <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="link">
              Open source
            </a>
          </div>
        </div>
        <form action={rescueRejectedCandidate}>
          <input type="hidden" name="id" value={candidate.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Rescuing...">
            Rescue
          </SubmitButton>
        </form>
      </div>
    </div>
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
  const visibleArchive = rejectedArchive.slice(0, 3);
  const hiddenArchive = rejectedArchive.slice(3);
  const recentSignals = signals.slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Admin · scanner</p>
          <h1 className="h-display">Scanner monitor</h1>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Source health, kept radar leads, and an expiring archive of auto-rejected candidates.
          </p>
        </div>
      </section>

      <SourceRadar
        data={scoreboard}
        integrations={integrations}
        description="Same aggregate funnel visitors can see, plus admin controls for preview and capped scans."
        actions={<ScanControls activeRunId={activeRun?.id ?? null} />}
      />

      <section className="panel-inset grid gap-2 border px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={status.className}>{status.label}</span>
          {latestRun ? <span>Last scan {relativeTime(latestRun.started_at)}</span> : <span>No completed scan yet</span>}
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span>Next check {control.paused ? "paused" : relativeTime(nextEligible.toISOString())}</span>
          {latestFind ? (
            <>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span>Most recent kept signal {relativeTime(latestFind.started_at)}</span>
            </>
          ) : null}
        </div>
        {redditOff ? <span className="badge badge-amber badge-dot justify-self-start">Reddit source off</span> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2 lg:items-start xl:grid-cols-[1.15fr_1.15fr_0.9fr]">
        <section className="panel space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h-section">Recent radar leads</h2>
            <span className="badge badge-dim">{signals.length} recent</span>
          </div>
          {recentSignals.length > 0 ? (
            recentSignals.map((signal) => <SignalRow key={signal.id} signal={signal} />)
          ) : (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              No kept source signals yet.
            </p>
          )}
        </section>

        <section className="panel space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h-section">Rejected archive</h2>
            <span className="badge badge-dim">
              <span className="num">{rejectedArchive.length}</span>&nbsp;expiring
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            Auto-rejected candidates, held briefly in case one was real. They expire on their own — rescuing is
            optional, not homework.
          </p>
          {visibleArchive.length > 0 ? (
            <>
              {visibleArchive.map((candidate) => (
                <ReviewCandidate key={candidate.id} candidate={candidate} />
              ))}
              {hiddenArchive.length > 0 ? (
                <details className="pt-1">
                  <summary className="cursor-pointer text-sm" style={{ color: "var(--text-dim)" }}>
                    Show {hiddenArchive.length} more before they expire
                  </summary>
                  <div className="mt-2">
                    {hiddenArchive.map((candidate) => (
                      <ReviewCandidate key={candidate.id} candidate={candidate} />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              Archive is empty.
            </p>
          )}
        </section>

        <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
          <section className="panel space-y-3">
            <h2 className="h-section">Latest run</h2>
            {latestRun ? (
              <>
                <p className="text-sm" style={{ color: latestRun.status === "failed" ? "var(--crimson-bright)" : "var(--text-dim)" }}>
                  {plainRunLine(latestRun)}
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="panel-inset border p-3">
                    <div className="stat-label">Work</div>
                    <p className="mt-1">
                      {latestRun.search_queries_used} searches · {latestRun.search_results_seen + latestRun.reddit_posts_seen} candidates ·{" "}
                      {latestRun.llm_calls_used} LLM
                    </p>
                  </div>
                  <div className="panel-inset border p-3">
                    <div className="stat-label">Operator readout</div>
                    <p className="mt-1">{summarizeRunMessages(latestRun.skips, latestRun.errors).operatorSummary}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                No completed scan yet.
              </p>
            )}
          </section>

          <details className="panel-inset border">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Scan history</summary>
            <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
          {runs.slice(0, 8).map((run) => (
            <div key={run.id} className="grid gap-2 border-b py-2 text-sm last:border-0 md:grid-cols-[auto_1fr_auto]" style={{ borderColor: "var(--border)" }}>
              <span className="num" style={{ color: "var(--text-dim)" }}>
                {formatEasternDateTime(run.started_at).replace(/^[A-Za-z]+ \d+, \d+, /, "")}
              </span>
              <span style={{ color: run.search_results_seen > 0 && run.status !== "skipped" ? "var(--text)" : "var(--text-faint)" }}>
                {plainRunLine(run)}
              </span>
              <span className="num" style={{ color: "var(--text-faint)" }}>
                {formatUsd(run.estimated_cost_usd)}
              </span>
            </div>
          ))}
          <details className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
            <summary className="cursor-pointer">Show raw scanner codes (funnel, skips, errors)</summary>
            <div className="mt-2 space-y-2">
              {runs.slice(0, 8).map((run) => (
                <div key={run.id} className="break-words">
                  <span className="num">{formatEasternDateTime(run.started_at)}</span>
                  {funnelSummary(run.funnel) ? <span> · {funnelSummary(run.funnel)}</span> : null}
                  {run.skips.length > 0 ? <span> · skips: {run.skips.join(", ")}</span> : null}
                  {run.errors.length > 0 ? <span> · errors: {run.errors.join(", ")}</span> : null}
                </div>
              ))}
            </div>
          </details>
            </div>
          </details>

          <details className="panel-inset border">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Scanner settings &amp; budget</summary>
            <div className="border-t px-4 py-4" style={{ borderColor: "var(--border)" }}>
          <form action={setScannerPolicy} className="space-y-3 text-sm">
            <input type="hidden" name="minIntervalMinutes" value={control.minIntervalMinutes} />
            <input type="hidden" name="modelPreset" value={control.modelPreset} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="stat-label">How often</span>
                <select name="cadence" defaultValue={control.paused ? "paused" : String(control.minIntervalMinutes)}>
                  <option value="60">Hourly</option>
                  <option value="120">Every 2 hours</option>
                  <option value="360">Every 6 hours</option>
                  <option value="1440">Daily</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="stat-label">Search depth</span>
                <select name="scheduledSearchCreditsPerRun" defaultValue={String(control.scheduledSearchCreditsPerRun)}>
                  <option value="1">1 search / run</option>
                  <option value="2">2 searches / run</option>
                  <option value="3">3 searches / run</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="stat-label">Monthly search cap</span>
                <input name="monthlyTavilyCreditCap" type="number" min="0" max="1000" step="1" defaultValue={control.monthlyTavilyCreditCap} className="num" />
              </label>
              <label className="grid gap-1">
                <span className="stat-label">Monthly LLM cap ($)</span>
                <input name="monthlyLlmUsdCap" type="number" min="1" max="5" step="0.25" defaultValue={control.monthlyLlmUsdCap} className="num" />
              </label>
            </div>
            <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              {`At this setting the scanner spends about ${projectedCredits} of your ${control.monthlyTavilyCreditCap} free monthly credits, then stands down. Cadence is ${cadenceLabel(control.minIntervalMinutes)}. Test scans never touch the public site. Cost is an estimate for budget tracking; on free tiers your real spend is $0.`}
            </p>
            <SubmitButton className="btn" pendingText="Saving...">
              Save settings
            </SubmitButton>
          </form>
            </div>
          </details>
        </aside>
      </section>
    </div>
  );
}
