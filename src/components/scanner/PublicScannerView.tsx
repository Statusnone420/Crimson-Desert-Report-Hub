import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { PlatformPulseCards } from "@/components/dispatch/PlatformPulseCards";
import { SegmentedFunnelBar } from "@/components/dispatch/RadarCharts";
import { categoryChartColor } from "@/lib/categoryColors";
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
  const maxTracked = Math.max(1, ...radar.categories.map((bucket) => bucket.tracked));

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

  // Flow vs stock, never one row: the week's candidate flow is a partition that
  // must visibly add up (reviewed = filtered + re-observed + kept); the working
  // set is a right-now state with its own units (leads / areas / issues).
  const flow = radar.connected ? radar.funnel7d : null;
  const problemAreasCaption =
    radar.activeLeadClusters === 0
      ? "Distinct issue areas holding at least one tracked lead"
      : data.awaiting === 0
        ? "Every area carries a public link or an approved report"
        : data.awaiting >= radar.activeLeadClusters
          ? "Holding leads — none corroborated enough to publish yet"
          : `${data.awaiting} of ${radar.activeLeadClusters} still awaiting corroboration`;
  const stock = [
    {
      key: "tracked",
      label: "Tracked leads",
      value: radar.recurring.trackedLeads,
      caption: `Sourced pages the radar is holding across ${radar.activeLeadClusters} problem area${radar.activeLeadClusters === 1 ? "" : "s"}`,
      valueClass:
        radar.recurring.trackedLeads > 0 ? "stat-band__value stat-band__value--blue" : "stat-band__value",
    },
    {
      key: "areas",
      label: "Problem areas",
      value: radar.activeLeadClusters,
      caption: problemAreasCaption,
      valueClass: "stat-band__value",
    },
    {
      key: "published",
      label: "Published issues",
      value: data.published,
      caption: "Full cards on the issue board",
      valueClass: data.published > 0 ? "stat-band__value stat-band__value--crimson" : "stat-band__value",
    },
  ];

  return (
    <div className="dispatch-container">
      <header className="dispatch-pagehead">
        <div className="dispatch-pagehead__copy">
          <p className="dispatch-kicker">The Observatory · Public source radar</p>
          <h1 className="dispatch-pagehead__title">How the radar reads the web</h1>
          <p className="dispatch-pagehead__dek">
            Public pages about Crimson Desert {patchVersion}, screened into private candidates, mapped leads, and
            reviewed links. A radar lead is context with a source — never player evidence on its own.
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

      <div className="brief-band__kicker-row" style={{ marginBottom: 14 }}>
        <h2 className="dispatch-kicker">This week · the candidate flow</h2>
        <span className="brief-band__caption dispatch-desktop-only">
          where every reviewed public candidate went
        </span>
      </div>
      {flow && flow.reviewed > 0 ? (
        <div aria-label="Weekly candidate flow">
          <p className="mono-label" style={{ marginBottom: 8 }}>
            {flow.reviewed} candidates reviewed in the last 7 days
          </p>
          <SegmentedFunnelBar
            reviewed={flow.reviewed}
            kept={flow.kept}
            reobserved={flow.reobserved}
            filtered={flow.filtered}
          />
        </div>
      ) : (
        <p className="radar-note" style={{ marginTop: 0 }}>
          {flow
            ? "The radar reviewed no public candidates in the last 7 days. Zeros are real readings."
            : "Scanner data is unavailable in this environment."}
        </p>
      )}

      <div className="brief-band__kicker-row" style={{ margin: "26px 0 14px" }}>
        <h2 className="dispatch-kicker">Right now · the working set</h2>
        <span className="brief-band__caption dispatch-desktop-only">
          counts are leads, areas, and issues — not people
        </span>
      </div>
      <div className="stat-band" aria-label="Radar working set">
        {stock.map((step) => (
          <div key={step.key} className="stat-band__cell">
            <div className="stat-band__label">{step.label}</div>
            <div className={step.valueClass}>{step.value}</div>
            <div className="stat-band__caption">{step.caption}</div>
          </div>
        ))}
      </div>

      {radar.connected && radar.recurring.trackedLeads > 0 ? (
        <section className="obs-intelligence" aria-label="Current radar working set">
          <div className="obs-questions__header">
            <div>
              <p className="dispatch-kicker">What is showing up</p>
              <h2 className="obs-section-title">Ranked problem areas</h2>
            </div>
            <p className="obs-questions__note">
              One readable view of the private and published working set. Counts are scanner leads, not people.
            </p>
          </div>
          <div className="obs-intelligence__grid">
            <ol className="obs-ranked" aria-label="Tracked radar leads ranked by problem area">
              {radar.categories.map((bucket, index) => (
                <li key={bucket.category} className="obs-ranked__row">
                  <span className="obs-ranked__rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="obs-ranked__label">
                    {CATEGORY_LABELS[bucket.category as keyof typeof CATEGORY_LABELS] ?? bucket.category}
                  </span>
                  <span className="obs-ranked__track" aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.max(3, (bucket.tracked / maxTracked) * 100)}%`,
                        backgroundColor: categoryChartColor(bucket.category),
                      }}
                    />
                  </span>
                  <span className="obs-ranked__count">
                    {bucket.tracked} tracked{bucket.new7d > 0 ? ` · ${bucket.new7d} new` : ""}
                  </span>
                </li>
              ))}
            </ol>
            <aside className="obs-readout" aria-label="Radar working set summary">
              <div className="obs-readout__stats">
                <div><b>{radar.recurring.trackedLeads}</b><span>tracked leads</span></div>
                <div><b>{radar.recurring.recurringLeads}</b><span>seen again</span></div>
                <div><b>{radar.window.newLeads7d}</b><span>new this week</span></div>
              </div>
              <div className="radar-health" aria-label="Source-date and patch coverage">
                <div>Real publication dates: {radar.dateCoverage.withSourceDate}/{radar.dateCoverage.tracked}</div>
                <div>
                  Explicit patch matches: {radar.eligibility.current_patch} · freshness inferred: {radar.eligibility.fresh_language}
                </div>
              </div>
              <p className="radar-note">
                Discovery time is not publication time. When a source omits its date, the radar says so instead of guessing.
              </p>
            </aside>
          </div>
        </section>
      ) : null}

      {data.steamPulse.length > 0 || data.platformContext || data.pulseReadFailures.length > 0 ? (
        <section className="context-pulse" aria-label="Platform context, not evidence">
          <div className="obs-questions__header">
            <div>
              <p className="dispatch-kicker dispatch-kicker--blue">Platform pulse</p>
              <h2 className="obs-section-title">Context, not evidence</h2>
            </div>
            <p className="obs-questions__note">
              Public platform activity can help time a change. It never becomes a player report or proves an issue.
            </p>
          </div>
          <PlatformPulseCards
            steamPulse={data.steamPulse}
            platformContext={data.platformContext}
            pulseReadFailures={data.pulseReadFailures}
          />
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
                    question="Player check-in · Affecting you?"
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
