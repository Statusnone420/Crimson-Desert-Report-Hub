import { recordScannerDecision, setScannerPolicy } from "@/app/admin/actions";
import { ScanControls } from "@/components/ScanControls";
import { SegmentedFunnelBar } from "@/components/dispatch/RadarCharts";
import { FeedbackRulesPanel, ScannerFeedbackDesk } from "@/components/scanner/ScannerFeedbackDesk";
import { SubmitButton } from "@/components/SubmitButton";
import { categoryChartColor } from "@/lib/categoryColors";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { IntegrationStatus } from "@/lib/env";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import type { AutomationControlState } from "@/lib/automation/settings";
import { displayCandidateCount, radarYieldPct } from "@/lib/observatoryMetrics";
import type {
  AdminSignalRow,
  AutomationRunRow,
  PublicScannerData,
  RejectedCandidateRow,
  ScannerFeedbackRuleRow,
} from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";

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

function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "not scheduled";
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
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
  const found = displayCandidateCount(run);
  if (found === 0) {
    return run.errors.length > 0
      ? `No sources reviewed - ${summarizeRunMessages(run.skips, run.errors).errorSummary}`
      : "Ran, nothing new";
  }
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

function signalRow(signal: AdminSignalRow, nowMs: number, feedbackLearningAvailable: boolean) {
  const isSteamReview = signal.source === "steam_review" || signal.source_type === "steam_review";
  return (
    <article key={signal.id} className="lead-item">
      <div className="lead-item__status">
        <span className={signal.public_status === "public" ? "is-green" : undefined}>
          {publicStatusLabel(signal.public_status)}
        </span>{" "}
        ·{" "}
        <i
          className="cat-swatch cat-swatch--meta"
          style={{ background: categoryChartColor(signal.category) }}
          aria-hidden="true"
        />
        {(CATEGORY_LABELS[signal.category as keyof typeof CATEGORY_LABELS] ?? signal.category).toUpperCase()} ·{" "}
        {(signal.source_type ?? signal.source).toUpperCase()} ·{" "}
        <span className={confidenceTone(signal.confidence)}>{signal.confidence.toUpperCase()} CONFIDENCE</span> · SEEN{" "}
        {signal.seen_count ?? 1}×
      </div>
      <h3 className="lead-item__title">{signal.title ?? "Untitled source lead"}</h3>
      <p className="lead-item__summary">{signal.summary}</p>
      <dl className="provenance provenance--compact" aria-label="Lead provenance">
        <div className="provenance__row">
          <dt className="provenance__key">Source</dt>
          <dd className="provenance__value">
            {sourceHost(signal)} · {(signal.source_type ?? signal.source).toUpperCase()}
          </dd>
        </div>
        <div className="provenance__row">
          <dt className="provenance__key">Classification</dt>
          <dd className="provenance__value">
            {(CATEGORY_LABELS[signal.category as keyof typeof CATEGORY_LABELS] ?? signal.category)} ·{" "}
            {signal.confidence} confidence · seen {signal.seen_count ?? 1}×
          </dd>
        </div>
        <div className="provenance__row">
          <dt className="provenance__key">State</dt>
          <dd className="provenance__value">
            {publicStatusLabel(signal.public_status).toLowerCase()} · last seen {relativeTime(signal.observed_at, nowMs)}{" "}
            ·{" "}
            <a href={signal.source_url} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              Open source
            </a>
          </dd>
        </div>
      </dl>
      {!feedbackLearningAvailable ? (
        <p className="decision-form__scope">Scanner learning unlocks after the database schema update.</p>
      ) : isSteamReview ? (
        <p className="decision-form__scope">
          Steam review leads share one provider URL. A review-specific lesson needs its recommendation hash, so this
          page cannot teach a safe scanner rule.
        </p>
      ) : (
        <details className="lead-feedback">
          <summary>Remove bad lead</summary>
          <form action={recordScannerDecision} className="decision-form dispatch-field lead-feedback__form">
            <input type="hidden" name="id" value={signal.id} />
            <input type="hidden" name="target_kind" value="signal" />
            <input type="hidden" name="scope" value="exact_url" />
            <label>
              <span>Why this lead is wrong</span>
              <select name="decision" defaultValue="off_topic" required>
                <option value="off_topic">Off topic</option>
                <option value="wrong_patch">Wrong patch</option>
                <option value="not_issue_report">Not an issue report</option>
                <option value="duplicate">Duplicate source</option>
              </select>
            </label>
            <label>
              <span>Operator reason</span>
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="What made this source irrelevant?"
              />
            </label>
            <p className="decision-form__scope">
              Removes only this source URL. The scanner will block the same page in future runs; the issue itself is
              unchanged.
            </p>
            <SubmitButton className="dispatch-btn tap-btn--danger" pendingText="Removing lead…">
              Remove lead and teach scanner
            </SubmitButton>
          </form>
        </details>
      )}
    </article>
  );
}

export function AdminScannerView({
  runs,
  signals,
  rejectedCandidates,
  feedbackRules,
  feedbackLearningAvailable,
  control,
  activeRun,
  latestRealRun,
  latestFind,
  scoreboard,
  radar,
  integrations,
  nowIso,
}: {
  runs: AutomationRunRow[];
  signals: AdminSignalRow[];
  rejectedCandidates: RejectedCandidateRow[];
  feedbackRules: ScannerFeedbackRuleRow[];
  feedbackLearningAvailable: boolean;
  control: AutomationControlState;
  activeRun: { id: string } | null;
  latestRealRun: AutomationRunRow | null;
  latestFind: AutomationRunRow | null;
  scoreboard: PublicScannerData;
  radar: PatchRadarData;
  integrations: IntegrationStatus[];
  nowIso: string;
}) {
  const now = new Date(nowIso);
  const nowMs = now.getTime();
  const lastScheduled = runs.find((run) => run.mode === "scheduled") ?? null;
  const nextEligible = nextEligibleScheduledScanAt(runs, now, control.minIntervalMinutes);
  const status = scannerStatus(control, activeRun, lastScheduled);
  const projectedCredits = projectedMonthlyCredits(control);
  const latestRun = latestRealRun;
  const optionalCandidates = rejectedCandidates.filter(
    (candidate) => !candidate.rescued_at && !candidate.decision_id && !candidate.feedback_rule_id,
  );
  const recentSignals = signals.slice(0, 6);
  const olderSignals = signals.slice(6);
  const pausedIntegrations = integrations.filter((integration) => integration.paused);
  const attentionCount = radar.health.runs7d.failed + pausedIntegrations.length;
  const yieldPct = radarYieldPct(scoreboard.keptThisWeek, scoreboard.reviewedThisWeek);

  return (
    <>
      <header className="dispatch-pagehead" style={{ paddingBottom: 30 }}>
        <div className="dispatch-pagehead__copy">
          <p className="dispatch-kicker dispatch-kicker--amber">Operator · The Observatory</p>
          <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
            Today&apos;s radar desk
          </h1>
          <p className="dispatch-pagehead__dek" style={{ maxWidth: "54ch" }}>
            What changed, what keeps recurring, and what needs you — with the full review, rescue, and budget
            workflows below.
          </p>
        </div>
        <div className="op-actions">
          <ScanControls activeRunId={activeRun?.id ?? null} />
        </div>
      </header>

      <div className="op-status-line">
        <span className={status.toneClass}>● {status.label}</span>
        {" · "}
        {latestRun ? `LAST SCAN ${relativeTime(latestRun.started_at, nowMs)}` : "NO COMPLETED SCAN YET"}
        {" · "}
        {control.paused ? "NEXT CHECK PAUSED" : `NEXT CHECK ${relativeTime(nextEligible.toISOString(), nowMs)}`}
        {latestFind ? ` · MOST RECENT KEPT LEAD ${relativeTime(latestFind.started_at, nowMs)}` : ""}
        {pausedIntegrations.map((integration) => (
          <span key={integration.key}>
            {" · "}
            <span className="is-amber">{integration.label.toUpperCase()} PAUSED</span>
          </span>
        ))}
      </div>

      {radar.connected ? (
        <div className="stat-band stat-band--radar" aria-label="Since the last day" style={{ marginBottom: 26 }}>
          <div className="stat-band__cell">
            <div className="stat-band__label">New leads · 24h</div>
            <div
              className={
                radar.window.newLeads24h > 0 ? "stat-band__value stat-band__value--blue" : "stat-band__value"
              }
            >
              {radar.window.newLeads24h}
            </div>
            <div className="stat-band__caption">{radar.window.newLeads7d} in the last 7 days</div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Re-observed · 24h</div>
            <div
              className={
                radar.window.reobservations24h > 0 ? "stat-band__value stat-band__value--blue" : "stat-band__value"
              }
            >
              {radar.window.reobservations24h}
            </div>
            <div className="stat-band__caption">
              {radar.recurring.recurringLeads} of {radar.recurring.trackedLeads} tracked leads recur
            </div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Needs attention</div>
            <div
              className={
                attentionCount > 0 ? "stat-band__value stat-band__value--amber" : "stat-band__value"
              }
            >
              {attentionCount}
            </div>
            <div className="stat-band__caption">
              {attentionCount > 0 ? "Run or provider health needs a look" : "No scanner intervention required"}
            </div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Failed runs · 7d</div>
            <div
              className={
                radar.health.runs7d.failed > 0 ? "stat-band__value stat-band__value--crimson" : "stat-band__value"
              }
            >
              {radar.health.runs7d.failed}
            </div>
            <div className="stat-band__caption">
              {radar.health.runs7d.succeeded} ok · {radar.health.runs7d.skipped} skipped
            </div>
          </div>
          <div className="stat-band__cell">
            <div className="stat-band__label">Source dates</div>
            <div className="stat-band__value">
              {radar.dateCoverage.withSourceDate}/{radar.dateCoverage.tracked}
            </div>
            <div className="stat-band__caption">
              Leads with a real publication date — Tavily general search rarely provides one
            </div>
          </div>
        </div>
      ) : null}

      {radar.connected && radar.funnel7d.reviewed > 0 ? (
        /* Funnel as a proportional bar instead of a second stat band — the two
           bands read as clones; this row answers "where did the week's
           candidates go" in one shape and keeps the KPIs beside it. */
        <div className="desk-funnel" aria-label="Source radar funnel">
          <div className="desk-funnel__main">
            <div className="mono-label" style={{ marginBottom: 10 }}>
              This week · {radar.funnel7d.reviewed} candidates reviewed
            </div>
            <SegmentedFunnelBar
              reviewed={radar.funnel7d.reviewed}
              kept={radar.funnel7d.kept}
              reobserved={radar.funnel7d.reobserved}
              filtered={radar.funnel7d.filtered}
            />
          </div>
          <div className="desk-funnel__kpis">
            <div className="desk-funnel__kpi">
              <span className="mono-label">Awaiting</span>
              <span className="desk-funnel__num desk-funnel__num--blue">{scoreboard.awaiting}</span>
            </div>
            <div className="desk-funnel__kpi">
              <span className="mono-label">Published</span>
              <span className="desk-funnel__num desk-funnel__num--crimson">{scoreboard.published}</span>
            </div>
            <div className="desk-funnel__kpi">
              <span className="mono-label">Radar yield</span>
              <span className="desk-funnel__num">
                {scoreboard.reviewedThisWeek > 0 ? `${yieldPct.toFixed(1)}%` : "0%"}
              </span>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      <section className="operator-inbox" aria-label="Operator action inbox">
        <div>
          <p className="operator-inbox__eyebrow">Action inbox</p>
          <h2>{attentionCount === 0 ? "Nothing requires intervention." : `${attentionCount} scanner health item${attentionCount === 1 ? "" : "s"} need a look.`}</h2>
          <p>
            {feedbackLearningAvailable
              ? "Auto-rejected pages are not assignments. They stay private, expire automatically, and appear below only so you can teach the scanner when a bad pattern is worth remembering."
              : "Scanner learning unlocks after the database schema update. You can still inspect candidates and keep a missed relevant lead."}
          </p>
        </div>
        <div className="operator-inbox__facts">
          <span><b>{radar.health.runs7d.failed}</b> failed runs · 7d</span>
          <span><b>{optionalCandidates.length}</b> optional teaching candidates</span>
          <span>
            {feedbackLearningAvailable ? <><b>{feedbackRules.length}</b> active scanner lessons</> : "Learning schema pending"}
          </span>
        </div>
      </section>

      <div className="operator-workbench">
        <section className="operator-workbench__main" aria-label="Teach the scanner">
          <div className="section-heading">
            <div>
              <p className="dispatch-kicker dispatch-kicker--amber">Teach the scanner · Optional</p>
              <h2 className="section-heading__title">Review the pattern, not a dropdown farm.</h2>
            </div>
            <p className="section-heading__note">
              Keep a missed lead, or record why a page is wrong. Exact-page rules are safest; broader rules require
              an explicit confirmation and can always be undone.
            </p>
          </div>
          <ScannerFeedbackDesk
            candidates={rejectedCandidates}
            nowIso={nowIso}
            feedbackLearningAvailable={feedbackLearningAvailable}
          />
        </section>

        <aside className="operator-workbench__rail" aria-label="Latest run and scanner settings">
          <div className="op-rail-block">
            <p className="mono-label">Latest run</p>
            {latestRun ? (
              <>
                <p className={latestRun.status === "failed" ? "op-rail__sentence is-crimson" : "op-rail__sentence"}>
                  {plainRunLine(latestRun)}.
                </p>
                <p className="op-rail__readout">{summarizeRunMessages(latestRun.skips, latestRun.errors).operatorSummary}</p>
                <dl className="run-facts">
                  <div><dt>Search</dt><dd>{latestRun.search_queries_used} credits</dd></div>
                  <div><dt>Candidates</dt><dd>{displayCandidateCount(latestRun)}</dd></div>
                  <div><dt>LLM</dt><dd>{latestRun.llm_calls_used} calls</dd></div>
                  <div><dt>Cost</dt><dd>{formatUsd(latestRun.estimated_cost_usd)}</dd></div>
                </dl>
              </>
            ) : <p className="op-rail__sentence">No completed scan yet.</p>}
          </div>

          <details className="operator-disclosure">
            <summary>Scan history and diagnostics</summary>
            <div className="operator-disclosure__body">
              {runs.slice(0, 8).map((run) => (
                <div key={run.id} className="op-history-row">
                  <span className="num-quiet">{formatEasternDateTime(run.started_at).replace(/^[A-Za-z]+ \d+, \d+, /, "")}</span>
                  <span>{plainRunLine(run)}</span>
                  <span className="num-quiet">{formatUsd(run.estimated_cost_usd)}</span>
                </div>
              ))}
              <details className="raw-diagnostics">
                <summary>Raw funnel, skip, and error codes</summary>
                {runs.slice(0, 8).map((run) => (
                  <p key={run.id}>
                    {formatEasternDateTime(run.started_at)}
                    {funnelSummary(run.funnel) ? ` · ${funnelSummary(run.funnel)}` : ""}
                    {run.skips.length > 0 ? ` · skips: ${run.skips.join(", ")}` : ""}
                    {run.errors.length > 0 ? ` · errors: ${run.errors.join(", ")}` : ""}
                  </p>
                ))}
              </details>
            </div>
          </details>

          <details className="operator-disclosure">
            <summary>Scanner cadence and budget</summary>
            <form action={setScannerPolicy} className="operator-disclosure__body decision-form dispatch-field">
              <input type="hidden" name="minIntervalMinutes" value={control.minIntervalMinutes} />
              <input type="hidden" name="modelPreset" value={control.modelPreset} />
              <label><span>How often</span><select name="cadence" defaultValue={control.paused ? "paused" : String(control.minIntervalMinutes)}>
                <option value="60">Hourly</option><option value="120">Every 2 hours</option>
                <option value="360">Every 6 hours</option><option value="1440">Daily</option><option value="paused">Paused</option>
              </select></label>
              <label><span>Search depth</span><select name="scheduledSearchCreditsPerRun" defaultValue={String(control.scheduledSearchCreditsPerRun)}>
                <option value="1">1 search / run</option><option value="2">2 searches / run</option><option value="3">3 searches / run</option>
              </select></label>
              <label><span>Monthly search cap</span><input name="monthlyTavilyCreditCap" type="number" min="0" max="1000" step="1" defaultValue={control.monthlyTavilyCreditCap} /></label>
              <label><span>Monthly LLM cap ($)</span><input name="monthlyLlmUsdCap" type="number" min="0" max="2" step="0.25" defaultValue={control.monthlyLlmUsdCap} /></label>
              <p className="op-note">About {projectedCredits} scheduled Tavily credits monthly at this setting, capped at {control.monthlyTavilyCreditCap}. LLM spend stops at ${control.monthlyLlmUsdCap.toFixed(2)}. Cadence is {cadenceLabel(control.minIntervalMinutes)}.</p>
              <SubmitButton className="dispatch-btn" pendingText="Saving...">Save settings</SubmitButton>
            </form>
          </details>
        </aside>
      </div>

      <section className="operator-records" aria-label="Automatic scanner records">
        <div className="section-heading section-heading--compact">
          <div><p className="dispatch-kicker">Automatic records</p><h2 className="section-heading__title">What the scanner kept</h2></div>
          <p className="section-heading__note">Inspect provenance, open the source, or remove one bad lead without hiding the whole issue.</p>
        </div>
        <div className="lead-record-grid">
          {recentSignals.length > 0
            ? recentSignals.map((signal) => signalRow(signal, nowMs, feedbackLearningAvailable))
            : <p className="decision-empty">No kept source leads yet.</p>}
        </div>
        {olderSignals.length > 0 ? (
          <details className="operator-disclosure operator-disclosure--records">
            <summary>Browse {olderSignals.length} older {olderSignals.length === 1 ? "lead" : "leads"}</summary>
            <div className="lead-record-grid operator-disclosure__body">
              {olderSignals.map((signal) => signalRow(signal, nowMs, feedbackLearningAvailable))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="feedback-ledger" aria-label="Active scanner feedback rules">
        <div className="section-heading section-heading--compact">
          <div><p className="dispatch-kicker">Active lessons</p><h2 className="section-heading__title">What the scanner will remember</h2></div>
          <p className="section-heading__note">Visibility and learning stay separate. Hiding an issue never poisons discovery; only an explicit scanner decision creates a rule.</p>
        </div>
        {feedbackLearningAvailable ? (
          <FeedbackRulesPanel rules={feedbackRules} nowIso={nowIso} />
        ) : (
          <p className="decision-empty">Scanner learning unlocks after the database schema update.</p>
        )}
      </section>
    </>
  );
}
