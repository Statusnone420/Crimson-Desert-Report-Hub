import { rescueRejectedCandidate, setScannerPolicy } from "@/app/admin/actions";
import { ScanControls } from "@/components/ScanControls";
import { SubmitButton } from "@/components/SubmitButton";
import type { Features, IntegrationStatus } from "@/lib/env";
import {
  describeScanPlain,
  formatEasternDateTime,
  plainSkipPhrase,
  summarizeRunMessages,
} from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import type { AutomationControlState } from "@/lib/automation/settings";
import type { AutomationRunRow, PublicScannerData, RejectedCandidateRow } from "@/lib/queries";

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

function funnelSummary(funnel: Record<string, number> | null): string | null {
  if (!funnel) return null;
  const { searchResultsSeen, candidatesSeen, deduped, prefilterRejected, llmEligible, llmCalls, kept, promoted } = funnel;
  if ([candidatesSeen, deduped, prefilterRejected, llmEligible, llmCalls, kept, promoted].some((v) => v === undefined)) {
    return null;
  }
  const results = searchResultsSeen === undefined ? "" : `${searchResultsSeen} results → `;
  return `${results}${candidatesSeen} screened → ${deduped} deduped → ${prefilterRejected} pre-filtered → ${llmEligible} LLM-eligible → ${llmCalls} LLM → ${kept} kept → ${promoted} promoted`;
}

function plainRunLine(run: AutomationRunRow): string {
  if (run.status === "skipped") {
    return summarizeRunMessages(run.skips, run.errors).operatorSummary;
  }
  if (run.search_results_seen === 0) return "Ran, nothing new";
  const scan = describeScanPlain(run);
  const parts = [`Found ${scan.found}, kept ${scan.kept}`];
  if (scan.reConfirmed > 0) parts.push(`re-confirmed ${scan.reConfirmed}`);
  if (scan.held > 0) parts.push(`held ${scan.held}`);
  if (scan.published > 0) parts.push(`published ${scan.published}`);
  return parts.join(", ");
}

export function AdminScannerView({
  runs,
  rejectedCandidates,
  control,
  activeRun,
  scoreboard,
  features,
  integrations,
}: {
  runs: AutomationRunRow[];
  rejectedCandidates: RejectedCandidateRow[];
  control: AutomationControlState;
  activeRun: { id: string } | null;
  scoreboard: PublicScannerData;
  features: Features;
  integrations: IntegrationStatus[];
}) {
  const now = new Date();
  const lastScheduled = runs.find((run) => run.mode === "scheduled") ?? null;
  const nextEligible = nextEligibleScheduledScanAt(runs, now, control.minIntervalMinutes);
  const status = scannerStatus(control, activeRun, lastScheduled);
  const projectedCredits = projectedMonthlyCredits(control);
  const redditOff = !features.reddit;

  const heroRun =
    runs.find((run) => run.mode !== "dry_run" && run.search_results_seen > 0) ??
    runs.find((run) => run.mode !== "dry_run" && run.status !== "skipped") ??
    null;
  const hero = heroRun ? describeScanPlain(heroRun) : null;
  const heroPct = hero && hero.found > 0 ? Math.round((hero.kept / hero.found) * 100) : 0;

  const heartbeats = runs.filter(
    (run) => run.mode === "scheduled" && run.status === "success" && run.search_results_seen === 0,
  ).length;

  const pendingRescues = rejectedCandidates.filter((candidate) => !candidate.rescued_at);
  const triage = pendingRescues.slice(0, 6);

  const verdict =
    hero && hero.kept > 0
      ? "The scanner is finding real player reports and re-confirming ones it already tracks."
      : "The scanner is active and screening public sources; no new reports were kept in the latest pass.";
  const verdictTail =
    scoreboard.published === 0
      ? redditOff
        ? "Nothing has gone public yet — a report needs a second independent source first, and Reddit is still switched off."
        : "Nothing has gone public yet — a report needs a second independent source first."
      : `${scoreboard.published} issue${scoreboard.published === 1 ? "" : "s"} are live as evidence-backed.`;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Admin · scanner</p>
          <h1 className="h-display">Source monitor</h1>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            What the scanner is finding, and where it could do better.
          </p>
        </div>
        <ScanControls activeRunId={activeRun?.id ?? null} />
      </section>

      <section className="panel" style={{ position: "sticky", top: "0.75rem", zIndex: 20 }}>
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex items-center gap-2 text-base font-semibold">
                <span className={status.className}>{status.label.toLowerCase()}</span>
                {status.label === "Active" ? "Healthy" : status.label}
              </span>
              {heroRun ? (
                <span className="badge badge-dim">
                  Last scan {formatEasternDateTime(heroRun.started_at).replace(/:\d\d [A-Z]+$/, "")} · found real signal
                </span>
              ) : null}
              <span className="badge badge-dim">
                Next check {control.paused ? "paused" : formatEasternDateTime(nextEligible.toISOString()).replace(/:\d\d [A-Z]+$/, "")}
              </span>
              {redditOff ? <span className="badge badge-amber badge-dot">Reddit source off</span> : null}
            </div>
            <p className="mt-2.5 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              {`${verdict} ${verdictTail}`}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="panel-inset border p-3">
              <div className="stat-label">Live now</div>
              <div className="stat-value" style={{ fontSize: "1.7rem", color: "var(--green-bright)" }}>
                {scoreboard.published}
              </div>
            </div>
            <div className="panel-inset border p-3">
              <div className="stat-label">Watching</div>
              <div className="stat-value" style={{ fontSize: "1.7rem", color: "var(--amber-bright)" }}>
                {scoreboard.awaiting}
              </div>
            </div>
            <div className="panel-inset border p-3">
              <div className="stat-label">Kept this week</div>
              <div className="stat-value" style={{ fontSize: "1.7rem" }}>
                {scoreboard.keptThisWeek}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <section className="panel space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="h-section">Last scan, in plain English</h2>
            {hero ? <span className="badge badge-green badge-dot">{hero.kept} kept</span> : null}
          </div>
          {hero && heroRun ? (
            <>
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                {formatEasternDateTime(heroRun.started_at)} · {(heroRun.intent ?? "discovery").replace(/_/g, " ")} · cost{" "}
                <span className="num">{formatUsd(heroRun.estimated_cost_usd)}</span>
              </p>
              <p className="text-base">
                Checked <span className="num font-semibold">{hero.found}</span> sources, kept{" "}
                <span className="num font-semibold">{hero.kept}</span> real reports.
              </p>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full p-0.5" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border)" }}>
                <span className="rounded-full" style={{ width: `${heroPct}%`, background: "var(--green)" }} />
                <span className="rounded-full" style={{ width: `${100 - heroPct}%`, background: "var(--border-strong)" }} />
              </div>
              <div className="flex gap-4 text-sm" style={{ color: "var(--text-dim)" }}>
                <span>
                  <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--green)" }} />
                  {hero.kept} kept
                </span>
                <span>
                  <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--border-strong)" }} />
                  {hero.dropped} dropped on purpose
                </span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="panel-inset border p-3 text-sm" style={{ color: "var(--text-dim)" }}>
                  <span className="num font-semibold" style={{ color: "var(--text)" }}>{hero.reConfirmed}</span> re-confirmed issues we already track
                </div>
                <div className="panel-inset border p-3 text-sm" style={{ color: "var(--text-dim)" }}>
                  <span className="num font-semibold" style={{ color: "var(--text)" }}>{hero.held}</span> held, waiting for a second source
                </div>
                <div className="panel-inset border p-3 text-sm" style={{ color: "var(--text-dim)" }}>
                  <span className="num font-semibold" style={{ color: "var(--text)" }}>{hero.published}</span> published this run
                </div>
              </div>
              {hero.dropped > 0 ? (
                <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  {hero.droppedBreakdown.length > 0
                    ? `Dropped correctly: ${hero.droppedBreakdown.map((entry) => `${entry.count} ${entry.label}`).join(", ")}. The scanner is not throwing away real complaints.`
                    : "Everything dropped here failed the relevance screen — off-topic or a different patch. The scanner is not throwing away real complaints."}
                </p>
              ) : null}
              {scoreboard.published === 0 ? (
                <div className="panel-inset text-sm leading-6" style={{ border: "1px solid var(--amber-edge)", background: "var(--amber-tint)", color: "var(--amber-bright)" }}>
                  {redditOff
                    ? "A report goes public once a second independent source backs it up. Turning on Reddit is the fastest way to move things from watching to live."
                    : "A report goes public once a second independent source backs it up. Corroboration is accruing each scan."}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              No completed scan with results yet.
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <section className="panel space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="h-section">Needs your eyes</h2>
              <span className="badge badge-dim">
                <span className="num">{pendingRescues.length}</span>
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              {"Dropped items the scanner wasn't sure about. Rescue anything that is actually a player problem."}
            </p>
            {triage.length > 0 ? (
              triage.map((candidate) => (
                <div key={candidate.id} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{candidate.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {candidate.source_domain ? <span className="num" style={{ color: "var(--text-faint)" }}>{candidate.source_domain}</span> : null}
                      <span style={{ color: "var(--text-dim)" }}>· {plainSkipPhrase(candidate.reason)}</span>
                    </div>
                  </div>
                  <form action={rescueRejectedCandidate}>
                    <input type="hidden" name="id" value={candidate.id} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Rescuing…">
                      Rescue
                    </SubmitButton>
                  </form>
                </div>
              ))
            ) : (
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                Nothing waiting — the queue is clear.
              </p>
            )}
          </section>

          <section className="panel space-y-1.5">
            <h2 className="h-section">Where it gets its info</h2>
            {integrations.map((integration) => (
              <div key={integration.key} className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: integration.connected ? "var(--green)" : "var(--amber)" }} />
                  {integration.label}
                </span>
                <span className={integration.connected ? "badge badge-green" : "badge badge-amber"}>
                  {integration.connected ? "on" : "off"}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 py-2 text-sm">
              <span style={{ color: "var(--text-dim)" }}>Budget</span>
              <span className="num" style={{ color: "var(--text)" }}>
                ~{projectedCredits} / {control.monthlyTavilyCreditCap} credits/mo
              </span>
            </div>
          </section>
        </aside>
      </div>

      {heartbeats > 0 ? (
        <p className="text-sm" style={{ color: "var(--text-faint)" }}>
          <span className="num" style={{ color: "var(--text-dim)" }}>{heartbeats}</span> scheduled checks found nothing new — that
          is normal; the scanner stands down when it is too soon or there is no fresh signal.
        </p>
      ) : null}

      <details className="panel-inset border" open>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Scan history</summary>
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
          {runs.slice(0, 8).map((run) => (
            <div key={run.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
              <span className="num" style={{ color: "var(--text-dim)" }}>{formatEasternDateTime(run.started_at).replace(/^[A-Za-z]+ \d+, \d+, /, "")}</span>
              <span style={{ color: run.search_results_seen > 0 && run.status !== "skipped" ? "var(--text)" : "var(--text-faint)" }}>{plainRunLine(run)}</span>
              <span className="num" style={{ color: "var(--text-faint)" }}>{formatUsd(run.estimated_cost_usd)}</span>
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
            <div className="grid gap-3 sm:grid-cols-3">
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
            </div>
            <input type="hidden" name="monthlyLlmUsdCap" value={control.monthlyLlmUsdCap} />
            <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              {`At this setting the scanner spends about ${projectedCredits} of your ${control.monthlyTavilyCreditCap} free monthly credits, then stands down. Cadence is ${cadenceLabel(control.minIntervalMinutes)}. Test scans never touch the public site.`}
            </p>
            <SubmitButton className="btn" pendingText="Saving…">
              Save settings
            </SubmitButton>
          </form>
        </div>
      </details>

      <p className="border-t pt-4 text-xs leading-5" style={{ color: "var(--text-faint)", borderColor: "var(--border)" }}>
        {"Raw submissions and rejected results stay private. Cost is an estimate for budget tracking — on the free tiers your real spend is $0."}
      </p>
    </div>
  );
}
