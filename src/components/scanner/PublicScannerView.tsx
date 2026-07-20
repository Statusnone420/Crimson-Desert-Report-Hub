import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { CategorySparklines, RecurrenceSmallMultiples, SegmentedFunnelBar } from "@/components/dispatch/RadarCharts";
import { categoryChartColor, chartCategories } from "@/lib/categoryColors";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { IntegrationStatus } from "@/lib/env";
import { patchFamilyKey } from "@/lib/patchWatch";
import type { DecoratedCluster, PublicScannerData } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PublicScannerView({
  data,
  radar,
  integrations,
  patchVersion,
  leadQuestions,
}: {
  data: PublicScannerData;
  radar: PatchRadarData;
  integrations: IntegrationStatus[];
  patchVersion: string;
  leadQuestions: DecoratedCluster[];
}) {
  const patchFamily = patchFamilyKey(patchVersion) ?? patchVersion;
  const visibleLeadQuestions = leadQuestions.slice(0, 4);

  // No fabricated schedule: the status block shows only what run history
  // records — state and last check. There is no stored "next check" time.
  const schedulerLabel = data.scannerConnected
    ? data.scannerActive
      ? "Scanner scheduled"
      : "Scanner paused"
    : "Scanner unavailable";
  const schedulerDotClass = data.scannerConnected
    ? data.scannerActive
      ? "obs-scheduler__dot--green"
      : "obs-scheduler__dot--amber"
    : "";

  const funnel = [
    {
      key: "reviewed",
      label: "Reviewed",
      value: data.reviewedThisWeek,
      caption: "Candidates checked in the last 7 days",
      valueClass: "stat-band__value",
    },
    {
      key: "filtered",
      label: "Filtered",
      value: data.filteredThisWeek,
      caption: "Wrong patch, off-topic, or not a player problem",
      valueClass: "stat-band__value",
    },
    {
      key: "awaiting",
      label: "Awaiting corroboration",
      value: data.awaiting,
      caption: "Plausible lead, not enough sources yet",
      valueClass: "stat-band__value stat-band__value--blue",
    },
    {
      key: "published",
      label: "Published issues",
      value: data.published,
      caption: "Full cards on the issue board — player evidence, a confirmation signal, or a reviewed link",
      valueClass: "stat-band__value stat-band__value--crimson",
    },
  ];

  return (
    <div className="dispatch-container">
      <header className="dispatch-pagehead">
        <div className="dispatch-pagehead__copy">
          <p className="dispatch-kicker">The Observatory · Public source radar</p>
          <h1 className="dispatch-pagehead__title">How the radar reads the web</h1>
          <p className="dispatch-pagehead__dek">
            Crimson Desert {patchVersion} web chatter, filtered into source health, mapped leads, and published
            links. A lead is a rumor with a link — players can add a confirmation signal on the Issue Board.
          </p>
        </div>
        <div className="obs-scheduler">
          <span className={schedulerDotClass} aria-hidden="true">
            ●
          </span>{" "}
          {schedulerLabel}
          <br />
          {data.lastCheckedAt ? `Last checked ${timeAgo(data.lastCheckedAt)}` : "No runs recorded"}
        </div>
      </header>

      <div className="stat-band" aria-label="Source radar funnel">
        {funnel.map((step) => (
          <div key={step.key} className="stat-band__cell">
            <div className="stat-band__label">{step.label}</div>
            <div className={step.valueClass}>{step.value}</div>
            <div className="stat-band__caption">{step.caption}</div>
          </div>
        ))}
      </div>

      {radar.connected && radar.recurring.trackedLeads > 0 ? (
        <section className="obs-questions" aria-label="The radar's working set">
          <div className="obs-questions__header">
            <h2 className="dispatch-kicker">The radar&apos;s working set</h2>
            <p className="obs-questions__note">
              Counts and positions only. Lead titles, links, and rejected candidates stay private until
              corroboration publishes them.
            </p>
          </div>
          <div className="radar-grid" style={{ marginTop: 0 }}>
            <div className="radar-main">
              <div>
                <p className="brief-band__caption" style={{ marginBottom: 8 }}>
                  Recurrence by problem area — one panel per area, all on shared scales. Right means tracked
                  longer; higher means seen in more scans. Solid dots are published leads, hollow dots private.
                </p>
                <RecurrenceSmallMultiples
                  points={radar.recurrence}
                  categories={chartCategories(radar.recurrence.map((point) => point.category))}
                />
              </div>
              {radar.weekly.length > 1 ? (
                <div>
                  <p className="brief-band__caption" style={{ marginBottom: 8 }}>
                    Still-tracked leads first seen per week by problem area — each line wears its area&apos;s color:
                  </p>
                  <CategorySparklines
                    weeks={radar.weekly}
                    categories={chartCategories(radar.weekly.flatMap((week) => Object.keys(week.counts)))}
                    width={330}
                  />
                </div>
              ) : null}
              {radar.funnel7d.reviewed > 0 ? (
                <div>
                  <p className="brief-band__caption" style={{ marginBottom: 8 }}>
                    What happened to the {radar.funnel7d.reviewed} candidates reviewed this week:
                  </p>
                  <SegmentedFunnelBar
                    reviewed={radar.funnel7d.reviewed}
                    kept={radar.funnel7d.kept}
                    reobserved={radar.funnel7d.reobserved}
                    filtered={radar.funnel7d.filtered}
                  />
                </div>
              ) : null}
            </div>
            <aside className="radar-rail" aria-label="Working set composition">
              <div>
                <div className="mono-label" style={{ marginBottom: 10 }}>
                  Tracked leads by category
                </div>
                <div className="cat-legend">
                  {radar.categories.map((bucket) => (
                    <div key={bucket.category} className="cat-legend__row">
                      <span>
                        <i
                          className="cat-swatch"
                          style={{ background: categoryChartColor(bucket.category) }}
                          aria-hidden="true"
                        />
                        {CATEGORY_LABELS[bucket.category as keyof typeof CATEGORY_LABELS] ?? bucket.category}
                      </span>
                      <span className="num-quiet">
                        {bucket.tracked}
                        {bucket.new7d > 0 ? ` (+${bucket.new7d} this week)` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="radar-health" aria-label="Source-date coverage">
                <div>
                  Source dates: {radar.dateCoverage.withSourceDate} of {radar.dateCoverage.tracked} leads
                </div>
                <div>
                  Patch match: {radar.eligibility.current_patch} explicit · {radar.eligibility.fresh_language}{" "}
                  fresh language · {radar.eligibility.unknown_source_freshness} unknown freshness
                </div>
              </div>
              <p className="radar-note">
                &ldquo;Seen&rdquo; times are scanner observations — when the radar found a page, not when it was
                posted. The search provider rarely supplies publication dates, so the radar never guesses them.
              </p>
            </aside>
          </div>
        </section>
      ) : null}

      <div className="obs-health" aria-label="Scanner integrations">
        {integrations.map((integration) => (
          <div key={integration.key} className="obs-health__item">
            <div className="obs-health__topline">
              <span className="obs-health__name">{integration.label}</span>
              <span
                className={
                  integration.paused
                    ? "obs-health__state obs-health__state--amber"
                    : integration.connected
                      ? "obs-health__state obs-health__state--green"
                      : "obs-health__state"
                }
              >
                {integration.paused ? "Paused" : integration.connected ? "Connected" : "Off"}
              </span>
            </div>
            <p className="obs-health__caption">{integration.detail}</p>
          </div>
        ))}
      </div>

      <section className="obs-questions" aria-label="Questions from the radar">
        <div className="obs-questions__header">
          <h2 className="dispatch-kicker">Questions from the radar</h2>
          <p className="obs-questions__note">
            Mapped leads, not evidence. A tap adds a counted player signal without publishing the private
            candidate link.
          </p>
        </div>
        {leadQuestions.length > 0 ? (
          <>
            {visibleLeadQuestions.map((cluster) => (
              <article key={cluster.id} className="obs-question" aria-label={cluster.title}>
                <div className="obs-question__main">
                  <div className="status-line status-line--blue">
                    <span className="status-line__dot" aria-hidden="true" />
                    <span className="status-line__label--blue">RADAR LEAD</span>
                  </div>
                  <h3 className="obs-question__title">{cluster.title}</h3>
                  <p className="obs-question__explainer">
                    The scanner mapped {cluster.candidateSignalCount}{" "}
                    {cluster.candidateSignalCount === 1 ? "lead" : "leads"} to this issue. Leads do not change its
                    evidence count.
                  </p>
                </div>
                <div className="obs-question__tap">
                  <ConfirmButtons
                    clusterId={cluster.id}
                    storageScope={patchFamily}
                    question="Do you have this?"
                    kinds={["have_it"]}
                    counts={{ have_it: cluster.confirmations.byKind.have_it.count }}
                  />
                </div>
              </article>
            ))}
            {leadQuestions.length > visibleLeadQuestions.length ? (
              <p className="obs-questions__note" style={{ textAlign: "left", marginTop: 12 }}>
                Showing {visibleLeadQuestions.length} of {leadQuestions.length} mapped questions. The complete set
                remains listed on the issue board.
              </p>
            ) : null}
          </>
        ) : (
          <p className="obs-question__empty">
            {data.scannerConnected
              ? "The radar has no open questions for this patch."
              : "No mapped radar questions are available in this environment. Official patch context remains available."}
          </p>
        )}
      </section>

      {!data.scannerConnected ? (
        <p className="obs-question__empty" style={{ paddingBottom: 24 }}>
          Offline view. Scanner data is unavailable in this environment; private candidates and rejected URLs stay
          hidden.
        </p>
      ) : null}

      <section className="obs-rule-band" aria-label="Display rule">
        <div className="obs-rule-band__label">Display rule</div>
        <p className="obs-rule-band__copy">
          Source links display only after an approved player report plus source trust, or corroboration across
          independent sources (with stricter thresholds for untrusted sites). The link still remains a lead, not
          player evidence.
        </p>
        <div className="obs-rule-band__link">
          <Link href="/about" className="dispatch-link">
            Read the method ↗
          </Link>
        </div>
      </section>

      <section className="obs-method" aria-label="Privacy and publishing posture">
        <div className="obs-method__col">
          <h2 className="obs-method__heading">Privacy</h2>
          <p className="obs-method__copy">
            Raw submissions, rejected candidates, scanner logs, and source URLs that fail review stay private.
          </p>
        </div>
        <div className="obs-method__col">
          <h2 className="obs-method__heading">Publishing rule</h2>
          <p className="obs-method__copy">
            A full issue card needs an approved player report or corroboration from independent public sources.
          </p>
        </div>
        <div className="obs-method__col">
          <h2 className="obs-method__heading">Published links</h2>
          <p className="obs-method__copy">
            Published issues show reviewed source links and approved report excerpts so readers can inspect each
            input themselves.
          </p>
        </div>
      </section>

      <section className="obs-cta">
        <Link href="/issues" className="dispatch-btn">
          See the Issue Board
        </Link>
        <Link href="/report" className="dispatch-btn dispatch-btn--secondary">
          File a report
        </Link>
      </section>
    </div>
  );
}
