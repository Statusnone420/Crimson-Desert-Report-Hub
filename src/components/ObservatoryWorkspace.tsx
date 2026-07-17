"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { GraymaneWatch } from "@/components/GraymaneWatch";
import { ScannerActivityChart } from "@/components/ScannerActivityChart";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { radarYieldPct } from "@/lib/observatoryMetrics";
import type { PublicScannerData } from "@/lib/queries";
import type { ObservatoryData } from "@/lib/telemetry.server";

export type ObservatoryPlayerEvidence = {
  platforms: [string, number][];
  categories: [string, number][];
  gpus: [string, number][];
};

type WorkspaceTab = "activity" | "funnel" | "sources" | "signal-mix" | "player-evidence";

const TABS: { id: WorkspaceTab; label: string; shortLabel: string }[] = [
  { id: "activity", label: "Activity", shortLabel: "Activity" },
  { id: "funnel", label: "Funnel", shortLabel: "Funnel" },
  { id: "sources", label: "Sources", shortLabel: "Sources" },
  { id: "signal-mix", label: "Signal mix", shortLabel: "Signal mix" },
  { id: "player-evidence", label: "Player evidence", shortLabel: "Player evidence" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function sumEntries(entries: [string, number][]): number {
  return entries.reduce((sum, [, value]) => sum + value, 0);
}

function EmptyView({ children }: { children: string }) {
  return <div className="observatory-empty">{children}</div>;
}

function ActivityView({ data }: { data: ObservatoryData }) {
  const hasActivity = data.daily.some((point) => point.reviewed > 0);

  return (
    <div className="observatory-view observatory-view--activity">
      <div className="observatory-view__heading">
        <div>
          <span className="eyebrow">Daily intake</span>
          <h3>Reviewed versus survived screening</h3>
        </div>
        <span className="observatory-view__unit">last 30 days · per day</span>
      </div>
      <div className="observatory-chart-stage observatory-chart-stage--activity">
        {hasActivity ? (
          <ScannerActivityChart daily={data.daily} />
        ) : (
          <EmptyView>Activity appears after the scanner records its first intake.</EmptyView>
        )}
      </div>
      <div className="observatory-legend" aria-label="Activity chart legend">
        <span><i className="observatory-legend__swatch observatory-legend__swatch--reviewed" />Reviewed</span>
        <span><i className="observatory-legend__swatch observatory-legend__swatch--survived" />Survived screening</span>
      </div>
    </div>
  );
}

type FunnelStep = {
  key: string;
  label: string;
  value: number;
  description: string;
  tone: "neutral" | "blue" | "crimson";
};

function FunnelView({ data }: { data: PublicScannerData }) {
  const steps: FunnelStep[] = [
    { key: "reviewed", label: "Reviewed", value: data.reviewedThisWeek, description: "candidate sources checked", tone: "neutral" },
    { key: "filtered", label: "Filtered", value: data.filteredThisWeek, description: "noise removed", tone: "neutral" },
    { key: "awaiting", label: "Awaiting", value: data.awaiting, description: "needs corroboration", tone: "blue" },
    { key: "published", label: "Published", value: data.published, description: "cleared for the board", tone: "crimson" },
  ];
  const max = Math.max(...steps.map((step) => step.value), 1);

  return (
    <div className="observatory-view observatory-view--funnel">
      <div className="observatory-view__heading">
        <div>
          <span className="eyebrow">Recent scanner window</span>
          <h3>From public chatter to a board lead</h3>
        </div>
        <span className="observatory-view__unit">current radar window</span>
      </div>
      <div className="observatory-pipeline" aria-label="Source radar funnel">
        {steps.map((step, index) => (
          <div
            key={step.key}
            className={`observatory-pipeline__step observatory-pipeline__step--${step.tone}`}
            style={{ "--pipeline-fill": `${step.value > 0 ? Math.max(6, Math.round((step.value / max) * 100)) : 0}%` } as CSSProperties}
          >
            <div className="observatory-pipeline__topline">
              <span className="num">0{index + 1}</span>
              <span className="stat-label">{step.label}</span>
            </div>
            <strong className="observatory-pipeline__value num">{step.value}</strong>
            <p>{step.description}</p>
            <div className="observatory-pipeline__rule" aria-hidden="true"><span /></div>
          </div>
        ))}
      </div>
      <p className="observatory-view__note">
        The funnel is a rolling scanner-window readout; it is shown beside the all-patches observatory record, not
        added to it.
      </p>
      <div className="chart-accessible-data">
        <table>
          <caption>Source radar funnel from reviewed candidates to published issues</caption>
          <thead>
            <tr><th scope="col">Stage</th><th scope="col">Count</th><th scope="col">Meaning</th></tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.key}><th scope="row">{step.label}</th><td>{step.value}</td><td>{step.description}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourcesView({ data }: { data: ObservatoryData }) {
  const rows = data.domains.slice(0, 8);
  const maxKept = Math.max(...rows.map((row) => row.kept), 1);
  const maxFiltered = Math.max(...rows.map((row) => row.filtered), 1);

  return (
    <div className="observatory-view observatory-view--sources">
      <div className="observatory-view__heading">
        <div>
          <span className="eyebrow">Source landscape</span>
          <h3>Where the radar keeps finding signal</h3>
        </div>
        <span className="observatory-view__unit">ranked domains</span>
      </div>
      {rows.length === 0 ? (
        <EmptyView>Domain mix appears after the scanner records its first sources.</EmptyView>
      ) : (
        <div className="observatory-source-stage">
          <div className="observatory-source-stage__legend" aria-hidden="true">
            <span>kept · all patches</span><span>filtered · recent window</span>
          </div>
          {rows.map((row) => (
            <div key={row.domain} className="observatory-source-row">
              <div className="observatory-source-row__label">
                <span className="num">{row.domain}</span>
                <span className="num">{row.totalSeen} seen</span>
              </div>
              <div className="observatory-source-row__lanes">
                <div className="observatory-source-row__lane">
                  <span style={{ width: `${row.kept > 0 ? Math.max(3, Math.round((row.kept / maxKept) * 100)) : 0}%` }} />
                  <strong className="num">{row.kept}</strong>
                </div>
                <div className="observatory-source-row__lane observatory-source-row__lane--filtered">
                  <span style={{ width: `${row.filtered > 0 ? Math.max(3, Math.round((row.filtered / maxFiltered) * 100)) : 0}%` }} />
                  <strong className="num">{row.filtered}</strong>
                </div>
              </div>
            </div>
          ))}
          {data.domains.length > rows.length ? <p className="muted-note">+{data.domains.length - rows.length} more domains with smaller counts.</p> : null}
        </div>
      )}
      <p className="observatory-view__note">Kept means a tracked lead, not player evidence. The filtered lane is a rolling rescue-window count.</p>
      <div className="chart-accessible-data">
        <table>
          <caption>Signals kept per source domain and candidates filtered in the recent window</caption>
          <thead><tr><th scope="col">Domain</th><th scope="col">Kept</th><th scope="col">Filtered</th><th scope="col">Seen</th></tr></thead>
          <tbody>{data.domains.map((row) => <tr key={row.domain}><th scope="row">{row.domain}</th><td>{row.kept}</td><td>{row.filtered}</td><td>{row.totalSeen}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

const MIX_COLORS = ["var(--blue)", "var(--amber)", "var(--crimson)", "var(--green)", "var(--text-faint)"];

function SignalMixView({ data }: { data: ObservatoryData }) {
  const categories = Object.entries(data.signalCategories).sort((a, b) => b[1] - a[1]);
  const categoryTotal = sumEntries(categories);
  const confidenceRows = [
    { key: "high", label: "High", value: data.confidenceMix.high, tone: "green" },
    { key: "medium", label: "Medium", value: data.confidenceMix.medium, tone: "amber" },
    { key: "low", label: "Low", value: data.confidenceMix.low, tone: "neutral" },
  ];
  const confidenceTotal = confidenceRows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="observatory-view observatory-view--mix">
      <div className="observatory-view__heading">
        <div>
          <span className="eyebrow">Tracked signals</span>
          <h3>What the radar is finding</h3>
        </div>
        <span className="observatory-view__unit">category · confidence</span>
      </div>
      {categoryTotal === 0 && confidenceTotal === 0 ? (
        <EmptyView>Signal mix appears once the scanner has a tracked lead to classify.</EmptyView>
      ) : (
        <div className="observatory-mix-stage">
          <div className="observatory-mix-stage__categories">
            <div className="observatory-subhead"><span>Category mix</span><span className="num">{categoryTotal} signals</span></div>
            {categoryTotal > 0 ? (
              <>
                <div className="observatory-segmented" role="img" aria-label="Tracked signals by category">
                  {categories.map(([category, value], index) => (
                    <span
                      key={category}
                      title={`${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}: ${value}`}
                      style={{ width: `${(value / categoryTotal) * 100}%`, background: MIX_COLORS[index % MIX_COLORS.length] }}
                    />
                  ))}
                </div>
                <div className="observatory-segmented__legend">
                  {categories.map(([category, value], index) => (
                    <span key={category}><i style={{ background: MIX_COLORS[index % MIX_COLORS.length] }} />{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}<strong className="num">{value}</strong></span>
                  ))}
                </div>
              </>
            ) : <p className="muted-note">No classified signals yet.</p>}
          </div>
          <div className="observatory-mix-stage__confidence">
            <div className="observatory-subhead"><span>Extraction confidence</span><span className="num">{confidenceTotal} signals</span></div>
            <div className="observatory-confidence-columns">
              {confidenceRows.map((row) => (
                <div key={row.key} className="observatory-confidence-column">
                  <div className="observatory-confidence-column__scale">
                    <span className={`observatory-confidence-column__fill observatory-confidence-column__fill--${row.tone}`} style={{ height: `${row.value > 0 ? Math.max(6, percent(row.value, confidenceTotal)) : 0}%` }} />
                  </div>
                  <strong className="num">{row.value}</strong>
                  <span>{row.label}</span>
                  <small className="num">{percent(row.value, confidenceTotal)}%</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="observatory-view__note">Category and confidence describe scanner extraction. Neither is a player verdict.</p>
    </div>
  );
}

function EvidenceList({
  title,
  entries,
  max,
  labelFor,
  tone = "blue",
}: {
  title: string;
  entries: [string, number][];
  max: number;
  labelFor: (key: string) => string;
  tone?: "blue" | "amber";
}) {
  return (
    <div className="observatory-evidence-list">
      <div className="observatory-subhead"><span>{title}</span><span className="stat-label">approved reports</span></div>
      {entries.length === 0 ? (
        <p className="muted-note">No approved reports in this split yet.</p>
      ) : (
        <ol>
          {entries.map(([key, value], index) => (
            <li key={key}>
              <div className="observatory-evidence-list__label">
                <span className="num">0{index + 1}</span>
                <span>{labelFor(key)}</span>
                <strong className="num">{value}</strong>
              </div>
              <div className="observatory-evidence-list__track" aria-hidden="true">
                <span className={`observatory-evidence-list__fill observatory-evidence-list__fill--${tone}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PlayerEvidenceView({ data }: { data: ObservatoryPlayerEvidence }) {
  const maxPlatform = Math.max(...data.platforms.map(([, value]) => value), 1);
  const maxCategory = Math.max(...data.categories.map(([, value]) => value), 1);

  return (
    <div className="observatory-view observatory-view--player-evidence">
      <div className="observatory-view__heading">
        <div>
          <span className="eyebrow">Coverage</span>
          <h3>Who is carrying the evidence</h3>
        </div>
        <span className="observatory-view__unit">current patch</span>
      </div>
      {data.platforms.length === 0 && data.categories.length === 0 ? (
        <EmptyView>Player evidence splits appear once an approved report lands.</EmptyView>
      ) : (
        <div className="observatory-player-evidence">
          <EvidenceList
            title="Platform"
            entries={data.platforms}
            max={maxPlatform}
            labelFor={(key) => PLATFORM_LABELS[key as keyof typeof PLATFORM_LABELS] ?? key}
          />
          <EvidenceList
            title="Issue category"
            entries={data.categories}
            max={maxCategory}
            tone="amber"
            labelFor={(key) => CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS] ?? key}
          />
        </div>
      )}
      <div className="observatory-gpu-note">
        <div className="observatory-subhead"><span>Most-cited GPUs</span><span className="stat-label">optional report field</span></div>
        {data.gpus.length === 0 ? (
          <p className="muted-note">Appears once reports include hardware.</p>
        ) : (
          <div className="chip-list">{data.gpus.slice(0, 5).map(([gpu, count]) => <span key={gpu} className="chip">{gpu} <span className="num">{count}</span></span>)}</div>
        )}
      </div>
      <p className="observatory-view__note">Reports capture platform, category, severity, frequency, hardware, repro steps, and optional evidence links.</p>
    </div>
  );
}

function WorkspaceReadout({
  tab,
  data,
  radar,
  playerEvidence,
}: {
  tab: WorkspaceTab;
  data: ObservatoryData;
  radar: PublicScannerData;
  playerEvidence: ObservatoryPlayerEvidence;
}) {
  const yieldValue = radarYieldPct(data.totals.tracked, data.totals.reviewed);
  const activeDays = data.daily.filter((point) => point.reviewed > 0).length;
  const latestActive = [...data.daily].reverse().find((point) => point.reviewed > 0);
  const topDomain = data.domains[0];
  const categoryEntries = Object.entries(data.signalCategories).sort((a, b) => b[1] - a[1]);
  const topCategory = categoryEntries[0];
  const topPlatform = playerEvidence.platforms[0];

  if (tab === "activity") {
    return (
      <aside className="observatory-readout" aria-label="Activity readout">
        <div className="eyebrow">Radar yield</div>
        <div className="observatory-readout__leadline">
          <strong className="num">{yieldValue.toFixed(1)}%</strong>
          <GraymaneWatch data={data} />
        </div>
        <p>Graymane’s Watch: unique tracked leads divided by screened candidates.</p>
        <dl className="observatory-readout__facts">
          <div><dt>Screened</dt><dd className="num">{data.totals.reviewed.toLocaleString("en-US")}</dd></div>
          <div><dt>Tracked leads</dt><dd className="num">{data.totals.tracked.toLocaleString("en-US")}</dd></div>
          <div><dt>Repeat sightings</dt><dd className="num">{data.totals.reobservations.toLocaleString("en-US")}</dd></div>
          <div><dt>Active days</dt><dd className="num">{activeDays}</dd></div>
          <div><dt>Model calls</dt><dd className="num">{data.totals.llmCalls.toLocaleString("en-US")}</dd></div>
          <div><dt>Spend</dt><dd className="num">${data.totals.costUsd.toFixed(2)}</dd></div>
        </dl>
        <p className="observatory-readout__foot">{latestActive ? `Latest intake ${formatDate(latestActive.date)}.` : "No intake recorded yet."}</p>
      </aside>
    );
  }

  if (tab === "funnel") {
    return (
      <aside className="observatory-readout" aria-label="Funnel readout">
        <div className="eyebrow">Read the pipeline</div>
        <strong className="observatory-readout__number num">{radar.published}</strong>
        <p>published leads in the current scanner window.</p>
        <dl className="observatory-readout__facts">
          <div><dt>Awaiting</dt><dd className="num">{radar.awaiting}</dd></div>
          <div><dt>Reviewed</dt><dd className="num">{radar.reviewedThisWeek}</dd></div>
          <div><dt>Filtered</dt><dd className="num">{radar.filteredThisWeek}</dd></div>
        </dl>
        <p className="observatory-readout__foot">Last checked {formatDate(radar.lastCheckedAt)}. Scheduled scans are {radar.scannerActive ? "active" : "paused or unavailable"}.</p>
      </aside>
    );
  }

  if (tab === "sources") {
    return (
      <aside className="observatory-readout" aria-label="Sources readout">
        <div className="eyebrow">Source with the most kept leads</div>
        <strong className="observatory-readout__source num">{topDomain?.domain ?? "—"}</strong>
        <p>{topDomain ? `${topDomain.kept} kept across the all-patches record.` : "No domain record yet."}</p>
        <dl className="observatory-readout__facts">
          <div><dt>Tracked leads</dt><dd className="num">{data.totals.tracked}</dd></div>
          <div><dt>Domains touched</dt><dd className="num">{data.domains.length}</dd></div>
          <div><dt>Filtered recent</dt><dd className="num">{data.rejectionReasons.reduce((sum, row) => sum + row.count, 0)}</dd></div>
        </dl>
        <p className="observatory-readout__foot">Kept and filtered use different time scopes; they are not presented as one rate.</p>
      </aside>
    );
  }

  if (tab === "signal-mix") {
    const confidenceTotal = data.confidenceMix.high + data.confidenceMix.medium + data.confidenceMix.low;
    return (
      <aside className="observatory-readout" aria-label="Signal mix readout">
        <div className="eyebrow">Largest tracked category</div>
        <strong className="observatory-readout__source">{topCategory ? CATEGORY_LABELS[topCategory[0] as keyof typeof CATEGORY_LABELS] ?? topCategory[0] : "—"}</strong>
        <p>{topCategory ? `${topCategory[1]} tracked signal${topCategory[1] === 1 ? "" : "s"}.` : "No classified signals yet."}</p>
        <dl className="observatory-readout__facts">
          <div><dt>High confidence</dt><dd className="num">{data.confidenceMix.high}</dd></div>
          <div><dt>Medium confidence</dt><dd className="num">{data.confidenceMix.medium}</dd></div>
          <div><dt>Low confidence</dt><dd className="num">{data.confidenceMix.low}</dd></div>
        </dl>
        <p className="observatory-readout__foot">{confidenceTotal} classified signals in the current aggregate.</p>
      </aside>
    );
  }

  return (
    <aside className="observatory-readout" aria-label="Player evidence readout">
      <div className="eyebrow">Current patch evidence</div>
      <strong className="observatory-readout__number num">{data.totals.kept}</strong>
      <p>tracked leads are distinct from approved player evidence.</p>
      <dl className="observatory-readout__facts">
        <div><dt>Top platform</dt><dd>{topPlatform ? PLATFORM_LABELS[topPlatform[0] as keyof typeof PLATFORM_LABELS] ?? topPlatform[0] : "—"}</dd></div>
        <div><dt>Reports in split</dt><dd className="num">{sumEntries(playerEvidence.platforms)}</dd></div>
        <div><dt>GPUs cited</dt><dd className="num">{playerEvidence.gpus.length}</dd></div>
      </dl>
      <p className="observatory-readout__foot">A quiet evidence split stays quiet; no estimate fills it.</p>
    </aside>
  );
}

function renderView(tab: WorkspaceTab, data: ObservatoryData, radar: PublicScannerData, playerEvidence: ObservatoryPlayerEvidence) {
  if (tab === "activity") return <ActivityView data={data} />;
  if (tab === "funnel") return <FunnelView data={radar} />;
  if (tab === "sources") return <SourcesView data={data} />;
  if (tab === "signal-mix") return <SignalMixView data={data} />;
  return <PlayerEvidenceView data={playerEvidence} />;
}

export function ObservatoryWorkspace({
  data,
  radar,
  playerEvidence,
}: {
  data: ObservatoryData;
  radar: PublicScannerData;
  playerEvidence: ObservatoryPlayerEvidence;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("activity");
  const activeIndex = TABS.findIndex((tab) => tab.id === activeTab);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`observatory-tab-${nextTab.id}`)?.focus();
  };

  return (
    <section className="brief-section observatory-section" aria-labelledby="observatory-title">
      <div className="section-intro">
        <div>
          <div className="eyebrow">The observatory</div>
          <h2 id="observatory-title">The machine at work</h2>
        </div>
        <p>One workspace for intake, screening, sources, signal mix, and player evidence. Counts keep their scope.</p>
      </div>
      <div className="observatory-workspace" data-testid="observatory-workspace">
        <div className="observatory-workspace__topline">
          <div>
            <span className="eyebrow">All patches · aggregate scanner record</span>
            <p>Choose a lens. The record stays literal.</p>
          </div>
          <span className="badge badge-blue">All patches</span>
        </div>
        <div className="observatory-tabs" role="tablist" aria-label="Observatory views">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              id={`observatory-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`observatory-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className="observatory-tab"
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              <span className="observatory-tab__index num">0{index + 1}</span>
              <span>{tab.label}</span>
              <span className="sr-only"> view</span>
            </button>
          ))}
        </div>
        <div
          id={`observatory-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`observatory-tab-${activeTab}`}
          tabIndex={0}
          className="observatory-workspace__body"
        >
          <div className="observatory-workspace__stage">{renderView(activeTab, data, radar, playerEvidence)}</div>
          <WorkspaceReadout tab={activeTab} data={data} radar={radar} playerEvidence={playerEvidence} />
        </div>
        <div className="observatory-workspace__method">
          <span className="eyebrow">Method note</span>
          <p>
            Reviewed is intake. Filtered is screening. Kept is a radar lead. Player reports are evidence. Official notes are context.
          </p>
          <span className="observatory-workspace__selected num">{TABS[activeIndex]?.shortLabel} selected</span>
        </div>
      </div>
    </section>
  );
}
