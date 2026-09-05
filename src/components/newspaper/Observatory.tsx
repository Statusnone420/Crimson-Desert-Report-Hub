"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicScannerData } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";
import {
  buildRadarCategories,
  buildSteamReviewSeries,
  buildTwitchSeries,
  platformLabels,
  selectSteamReadings,
  selectTwitchWindow,
  type SteamReviewPoint,
  type TwitchPoint,
} from "@/lib/newspaperObservatory";

const number = (value: number) => value.toLocaleString("en-US");
const signed = (value: number | null) =>
  value === null ? "Unknown" : (value > 0 ? "+" : value < 0 ? "−" : "") + number(Math.abs(value));

function displayDate(value: string): string {
  const date = new Date(value.length === 10 ? value + "T00:00:00.000Z" : value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "Unknown date";
}

function captureLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    })
    : "Unknown capture";
}

function Options({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  options: Array<[string | number, string]>;
}) {
  return (
    <div className="obs-options" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={String(key)} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {text}
          {value === key ? <span aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

function niceAxisMaximum(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const multiplier = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return multiplier * power;
}

function SteamMovementChart({
  points,
  patch,
}: {
  points: SteamReviewPoint[];
  patch: PatchRadarData["patch"];
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = points.find((point) => point.snapshotDay === selectedDay) ?? points.at(-1) ?? null;
  if (!selected) return null;
  const maximum = niceAxisMaximum(Math.max(1, ...points.map((point) => Math.abs(point.reviewMovement ?? 0))));
  const patchDay = patch.publishedAt?.slice(0, 10) ?? null;
  const patchIndex = patchDay ? points.findIndex((point) => point.snapshotDay >= patchDay) : -1;

  return (
    <>
      <div className="obs-chart-readout">
        <p><span>{displayDate(selected.snapshotDay)}</span><strong>{signed(selected.reviewMovement)} reviews</strong></p>
        <span>{points.length} recorded reading{points.length === 1 ? "" : "s"} · {displayDate(points[0].snapshotDay)}–{displayDate(points.at(-1)?.snapshotDay ?? "")}</span>
      </div>
      <p className="obs-sentiment-readout" aria-live="polite">
        <span><i className="obs-key-positive" />{selected.positiveMovement === null ? "Positive movement unknown" : signed(selected.positiveMovement) + " positive"}</span>
        <span><i className="obs-key-negative" />{selected.negativeMovement === null ? "Negative movement unknown" : signed(selected.negativeMovement) + " negative"}</span>
        <span>Movement is since the previous recorded snapshot.</span>
      </p>
      <div className="obs-review-chart">
        <div className="obs-y-axis" aria-hidden="true">
          {[maximum, maximum / 2, 0, -maximum / 2, -maximum].map((tick) => <span key={tick}>{signed(tick)}</span>)}
        </div>
        <div className="obs-review-bars" style={{ position: "relative", borderBottom: 0 }}>
          <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px solid var(--line)" }} />
          {points.map((point, index) => {
            const selectedPoint = selected.snapshotDay === point.snapshotDay;
            const delta = point.reviewMovement;
            const height = delta === null ? 0 : (Math.abs(delta) / maximum) * 50;
            return (
              <div className="obs-review-column" key={point.snapshotDay}>
                <button
                  type="button"
                  className={"obs-review-hit" + (selectedPoint ? " is-selected" : "")}
                  aria-label={displayDate(point.snapshotDay) + ": " + (delta === null ? "no prior recorded baseline" : signed(delta) + " reviews since the previous recorded snapshot")}
                  aria-pressed={selectedPoint}
                  onPointerEnter={() => setSelectedDay(point.snapshotDay)}
                  onFocus={() => setSelectedDay(point.snapshotDay)}
                  onClick={() => setSelectedDay(point.snapshotDay)}
                >
                  {delta === null ? (
                    <span aria-hidden="true" style={{ position: "absolute", top: "50%", width: 8, borderTop: "1px solid var(--muted)" }} />
                  ) : delta === 0 ? (
                    <span aria-hidden="true" style={{ position: "absolute", top: "50%", width: 8, borderTop: "2px solid var(--blue)" }} />
                  ) : (
                    <span
                      className="obs-movement-bar"
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        height: height + "%",
                        top: delta < 0 ? "50%" : undefined,
                        bottom: delta > 0 ? "50%" : undefined,
                        background: selectedPoint ? "var(--red)" : delta < 0 ? "var(--green)" : undefined,
                      }}
                    />
                  )}
                </button>
                <span className={"obs-x-label" + ((index % 2 !== 0 && index !== points.length - 1) ? " obs-optional-date" : "")}>{displayDate(point.snapshotDay)}</span>
                {index === patchIndex ? <span className="obs-patch-marker"><i /><span>Patch {patch.version}</span></span> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="obs-chart-foot">
        <p><i className="obs-key-blue" />Review movement uses the recorded snapshot delta. Negative bars show a lower recorded total.</p>
        {patchDay ? <p>Patch {patch.version} released {displayDate(patchDay)}.</p> : <p>Patch release date is unavailable.</p>}
      </div>
    </>
  );
}

function SteamShare({
  points,
}: {
  points: SteamReviewPoint[];
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = points.find((point) => point.snapshotDay === selectedDay) ?? points.at(-1) ?? null;
  if (!selected) return null;
  const selectedIndex = points.indexOf(selected);
  const first = points[0];
  const last = points.at(-1) ?? first;
  const shareChange = last.positivePercentage - first.positivePercentage;

  return (
    <>
      <div className="obs-chart-readout">
        <p><span>{displayDate(selected.snapshotDay)}</span><strong>{selected.positivePercentage.toFixed(1)}% positive</strong></p>
        <span>{points.length} recorded reading{points.length === 1 ? "" : "s"} · recorded share</span>
      </div>
      <p className="obs-sentiment-readout" aria-live="polite">
        {selected.totalPositive === null || selected.totalNegative === null
          ? <span>Exact positive and negative totals are unknown for this capture.</span>
          : <><span><i className="obs-key-positive" />{number(selected.totalPositive)} positive</span><span><i className="obs-key-negative" />{number(selected.totalNegative)} negative</span></>}
      </p>
      <div className="obs-share-summary">
        <div className="obs-balance-track" role="img" aria-label={displayDate(selected.snapshotDay) + ": " + selected.positivePercentage.toFixed(1) + "% positive"}>
          <span style={{ width: selected.positivePercentage + "%" }} />
          <span style={{ width: (100 - selected.positivePercentage) + "%" }} />
        </div>
        <div className="obs-balance-labels"><span>Positive</span><span>Negative</span></div>
        <div className="obs-share-verdict">
          <p><strong>{first.positivePercentage.toFixed(1)}%</strong><span> at the first recorded reading</span><i aria-hidden="true">→</i><strong>{last.positivePercentage.toFixed(1)}%</strong><span> at the latest</span></p>
          <p className="obs-share-change">{signed(shareChange)} percentage points across {points.length} reading{points.length === 1 ? "" : "s"}</p>
        </div>
        <div className="obs-share-days">
          <button type="button" aria-label="Previous review reading" disabled={selectedIndex === 0} onClick={() => setSelectedDay(points[selectedIndex - 1].snapshotDay)}>← Previous</button>
          <span>{displayDate(selected.snapshotDay)} balance</span>
          <button type="button" aria-label="Next review reading" disabled={selectedIndex === points.length - 1} onClick={() => setSelectedDay(points[selectedIndex + 1].snapshotDay)}>Next →</button>
        </div>
      </div>
    </>
  );
}

function ReviewRecord({ data, radar }: { data: PublicScannerData; radar: PatchRadarData }) {
  const [readingCount, setReadingCount] = useState(14);
  const [metric, setMetric] = useState("movement");
  const series = buildSteamReviewSeries(data.steamPulse, data.pulseReadFailures.includes("steam"));
  if (series.availability !== "ready") {
    return <section id="review-record" className="obs-section"><div className="obs-section-heading"><div><p className="kicker">Steam reviews</p><h2>The review record</h2></div></div><p className="np-error">Steam review history is unavailable because no recorded snapshots are available.</p></section>;
  }
  const points = selectSteamReadings(series.points, readingCount);
  const latest = series.points.at(-1) ?? null;
  if (!latest) return null;

  return (
    <section id="review-record" className="obs-section" aria-labelledby="review-title">
      <div className="obs-section-heading"><div><p className="kicker">Steam reviews</p><h2 id="review-title">The review record</h2></div><div className="obs-review-totals"><span><strong>{number(latest.totalReviews)}</strong> total reviews</span><span><strong>{latest.positivePercentage.toFixed(1)}%</strong> recorded positive share</span></div></div>
      <div className="obs-review-controls">
        <Options label="Review chart" value={metric} onChange={(value) => setMetric(String(value))} options={[["movement", "Review movement"], ["share", "Positive share"]]} />
        <Options label="Review readings" value={readingCount} onChange={(value) => setReadingCount(Number(value))} options={[[7, "7 readings"], [14, "14 readings"]]} />
      </div>
      {metric === "share" ? <SteamShare points={points} /> : <SteamMovementChart points={points} patch={radar.patch} />}
      <details className="obs-data-table">
        <summary>Read the chart values</summary>
        <table><caption>Steam review snapshots · {points.length} recorded reading{points.length === 1 ? "" : "s"}</caption><thead><tr><th scope="col">Date</th><th scope="col">Review movement</th><th scope="col">Positive movement</th><th scope="col">Negative movement</th><th scope="col">Recorded positive share</th></tr></thead><tbody>{points.map((point) => <tr key={point.snapshotDay}><th scope="row">{displayDate(point.snapshotDay)}</th><td>{signed(point.reviewMovement)}</td><td>{signed(point.positiveMovement)}</td><td>{signed(point.negativeMovement)}</td><td>{point.positivePercentage.toFixed(1)}%</td></tr>)}</tbody></table>
        <p>Latest capture: {captureLabel(latest.collectedAt)} UTC. Exact positive and negative counts appear only when stored in the snapshot. Count changes can include edits and removals.</p>
      </details>
    </section>
  );
}

function TwitchTimeline({ data }: { data: PublicScannerData }) {
  const [hours, setHours] = useState(24);
  const [metric, setMetric] = useState<"viewers" | "streams">("viewers");
  const [selectedCapture, setSelectedCapture] = useState<string | null>(null);
  const [capturePage, setCapturePage] = useState(0);
  const series = buildTwitchSeries(data.platformContext, data.pulseReadFailures.includes("platform"));
  const window = selectTwitchWindow(series, hours);
  if (!window || window.points.length === 0) {
    return <div className="obs-audience"><p className="np-error">Twitch aggregate history is unavailable because no complete captures are available in this window.</p></div>;
  }

  const points = window.points;
  const selected = points.find((point) => point.capturedAt === selectedCapture) ?? points.at(-1) ?? null;
  if (!selected) return null;
  const latest = points.at(-1) ?? selected;
  const selectedIndex = points.indexOf(selected);
  const values = points.map((point) => point[metric]);
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const ceiling = niceAxisMaximum(peak);
  const pageSize = 12;
  const visibleCaptures = [...points].reverse().slice(capturePage * pageSize, (capturePage + 1) * pageSize);
  const x = (point: TwitchPoint) => 45 + ((new Date(point.capturedAt).getTime() - window.start) / (window.end - window.start)) * 640;
  const y = (point: TwitchPoint) => 220 - (point[metric] / ceiling) * 190;
  const selectAtPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const time = window.start + ratio * (window.end - window.start);
    const nearest = points.reduce((best, point) => Math.abs(new Date(point.capturedAt).getTime() - time) < Math.abs(new Date(best.capturedAt).getTime() - time) ? point : best);
    setSelectedCapture(nearest.capturedAt);
  };
  const captureSpan = displayDate(points[0].capturedAt) + "–" + displayDate(points.at(-1)?.capturedAt ?? "");

  return (
    <div className="obs-audience">
      <div className="obs-audience-heading"><span className="obs-platform-name">Twitch</span><span>{points.length} recorded captures · UTC</span></div>
      <div className="obs-audience-numbers"><div><strong>{number(latest.viewers)}</strong><span>Viewers at latest capture</span></div><div><strong>{number(latest.streams)}</strong><span>Live streams at latest capture</span></div></div>
      <div className="obs-review-controls">
        <Options label="Twitch metric" value={metric} onChange={(value) => setMetric(value === "streams" ? "streams" : "viewers")} options={[["viewers", "Viewers"], ["streams", "Streams"]]} />
        <Options label="Twitch window" value={hours} onChange={(value) => { setHours(Number(value)); setSelectedCapture(null); setCapturePage(0); }} options={[[24, "24 hours"], [168, "7 days"]]} />
      </div>
      <div className="obs-twitch-readout" aria-live="polite"><strong>{number(selected[metric])} {metric}</strong><span>{captureLabel(selected.capturedAt)} UTC</span></div>
      <svg className="obs-twitch-chart" viewBox="0 0 710 265" role="img" aria-label={(hours === 24 ? "24-hour" : "Seven-day") + " Twitch " + metric + " history. " + points.length + " recorded captures from " + captureSpan + ", observed low " + low + ", observed peak " + peak + "."} onPointerMove={selectAtPointer} onClick={selectAtPointer}>
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line className="obs-timeline-grid" x1="45" x2="685" y1={220 - tick * 47.5} y2={220 - tick * 47.5} /><text x="35" y={224 - tick * 47.5} textAnchor="end">{number((ceiling * tick) / 4)}</text></g>)}
        {window.segments.map((segment) => <polyline className="obs-timeline-line" key={segment[0].capturedAt} points={segment.map((point) => x(point) + "," + y(point)).join(" ")} />)}
        {points.map((point) => <circle className="obs-timeline-dot" key={point.capturedAt} cx={x(point)} cy={y(point)} r="2" />)}
        <line className="obs-timeline-guide" x1={x(selected)} x2={x(selected)} y1="20" y2="220" /><circle className="obs-timeline-selected" cx={x(selected)} cy={y(selected)} r="5" />
        {[0, 0.5, 1].map((fraction) => <text key={fraction} x={45 + fraction * 640} y="252" textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{new Date(window.start + fraction * (window.end - window.start)).toLocaleString("en-US", hours === 24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" })}</text>)}
      </svg>
      <label className="obs-capture-slider"><span>Explore each capture</span><input type="range" min="0" max={points.length - 1} step="1" value={selectedIndex} onChange={(event) => setSelectedCapture(points[Number(event.target.value)].capturedAt)} aria-label="Choose a Twitch capture" aria-valuetext={captureLabel(selected.capturedAt) + " UTC: " + selected[metric] + " " + metric} /></label>
      <div className="obs-range-facts"><span><b>{number(low)}</b> observed low</span><span><b>{number(peak)}</b> observed peak</span><span><b>{signed(latest[metric] - points[0][metric])}</b> first to last</span></div>
      <p className="obs-note">{window.segments.length > 1 ? "The line breaks where captures are more than three hours and fifteen minutes apart. " : ""}These are {points.length} available captures from {captureSpan}; a requested 7-day window does not imply seven days of complete coverage. Viewers and streams are audience activity, not player counts.</p>
      <details className="obs-twitch-values"><summary>Read the Twitch captures</summary><div className="obs-capture-table"><table><caption>Recorded Twitch aggregates · UTC · newest first</caption><thead><tr><th scope="col">Capture</th><th scope="col">Viewers</th><th scope="col">Streams</th></tr></thead><tbody>{visibleCaptures.map((point) => <tr key={point.capturedAt}><th scope="row">{captureLabel(point.capturedAt)}</th><td>{number(point.viewers)}</td><td>{number(point.streams)}</td></tr>)}</tbody></table></div>{points.length > pageSize ? <div className="obs-capture-pages"><button type="button" disabled={capturePage === 0} onClick={() => setCapturePage((page) => page - 1)}>← Newer captures</button><span aria-live="polite">{capturePage * pageSize + 1}–{Math.min((capturePage + 1) * pageSize, points.length)} of {points.length}</span><button type="button" disabled={(capturePage + 1) * pageSize >= points.length} onClick={() => setCapturePage((page) => page + 1)}>Older captures →</button></div> : null}</details>
    </div>
  );
}

function PlatformActivity({ data }: { data: PublicScannerData }) {
  const platforms = platformLabels(data);
  return (
    <section id="platform-activity" className="obs-section" aria-labelledby="platform-title">
      <div className="obs-section-heading"><div><p className="kicker">Platform activity</p><h2 id="platform-title">Beyond the game window</h2></div><p>Twitch audience history and the game’s listed platforms.</p></div>
      <div className="obs-platform-spread">
        <TwitchTimeline data={data} />
        <aside className="obs-platforms"><p className="kicker">The platform record</p><h3>Where the game is listed</h3>{platforms === null || platforms.length === 0 ? <p>IGDB platform metadata is unavailable because the latest capture has no listed platforms.</p> : <ul>{platforms.map((platform) => <li key={platform}>{platform}</li>)}</ul>}<p>Base-game platforms come from IGDB. Player totals for these platforms are not included in this record.</p>{data.platformContext?.igdbUrl ? <a href={data.platformContext.igdbUrl} target="_blank" rel="noreferrer noopener">View on IGDB ↗</a> : null}</aside>
      </div>
    </section>
  );
}

function ScannerRadar({ radar }: { radar: PatchRadarData }) {
  const [metric, setMetric] = useState<"tracked" | "newThisWeek">("tracked");
  const [active, setActive] = useState(0);
  const series = buildRadarCategories(radar);
  if (series.availability !== "ready") {
    return <section id="scanner-radar" className="obs-section"><div className="obs-section-heading"><div><p className="kicker">The source radar</p><h2>What keeps showing up?</h2></div></div><p className="np-error">Radar category data is unavailable because no recorded category counts are available.</p></section>;
  }
  const categories = series.categories;
  const selected = categories[Math.min(active, categories.length - 1)];
  const maximum = niceAxisMaximum(Math.max(1, ...categories.map((category) => category[metric])));
  const total = categories.reduce((sum, category) => sum + category[metric], 0);
  const point = (value: number, index: number, radius = 142): [number, number] => {
    const angle = (index * Math.PI * 2) / categories.length - Math.PI / 2;
    return [220 + Math.cos(angle) * value / maximum * radius, 192 + Math.sin(angle) * value / maximum * radius];
  };
  const flow = radar.funnel7d;
  const flowTotal = flow.reviewed;

  return (
    <section id="scanner-radar" className="obs-section" aria-labelledby="radar-title">
      <div className="obs-section-heading"><div><p className="kicker">The source radar</p><h2 id="radar-title">What keeps showing up?</h2></div><Options label="Radar count" value={metric} onChange={(value) => setMetric(value === "newThisWeek" ? "newThisWeek" : "tracked")} options={[["tracked", "Tracked leads"], ["newThisWeek", "New this week"]]} /></div>
      <div className="obs-radar-spread">
        <div className="obs-radar-figure"><p><strong>{total}</strong> {metric === "tracked" ? "tracked leads" : "new leads in seven days"} <span>· not confirmed bugs</span></p><svg viewBox="0 0 440 395" role="img" aria-label={(metric === "tracked" ? "Tracked leads" : "New leads this week") + " by category. " + categories.map((category) => category.label + ": " + category[metric]).join("; ")}><g className="obs-radar-grid">{[1, 2, 3, 4, 5].map((step) => <polygon key={step} points={categories.map((_, index) => point(step * maximum / 5, index).join(",")).join(" ")} />)}{categories.map((_, index) => <line key={index} x1="220" y1="192" x2={point(maximum, index)[0]} y2={point(maximum, index)[1]} />)}</g><polygon className="obs-radar-shape" points={categories.map((category, index) => point(category[metric], index).join(",")).join(" ")} />{categories.map((category, index) => { const current = point(category[metric], index); const label = point(maximum, index, 179); return <g key={category.category}><circle cx={current[0]} cy={current[1]} r={active === index ? 6 : 3} className={active === index ? "obs-radar-active" : ""} /><text x={label[0]} y={label[1]} textAnchor="middle">{category.short}</text></g>; })}{[1, 2, 3, 4, 5].map((step) => <text className="obs-radar-scale" key={step} x="207" y={192 - step / 5 * 142}>{step * maximum / 5}</text>)}</svg></div>
        <div className="obs-radar-ranking"><div className="obs-rank-labels"><span>Category</span><span>{metric === "tracked" ? "Tracked" : "New in 7 days"}</span></div>{categories.map((category, index) => <button type="button" className={"obs-rank-row" + (active === index ? " is-selected" : "")} key={category.category} aria-pressed={active === index} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}><span>{category.label}</span><span className="obs-rank-track"><i style={{ width: (category[metric] / maximum) * 100 + "%" }} /></span><strong>{category[metric]}</strong></button>)}<p className="obs-rank-readout" aria-live="polite"><b>{selected.label}</b> · {selected.tracked} tracked · {selected.newThisWeek} new this week</p></div>
      </div>
      <div className="obs-radar-foot"><span><b>{radar.recurring.recurringLeads}</b> of {radar.recurring.trackedLeads} tracked leads seen again</span><span><b>{radar.activeLeadClusters}</b> mapped issue areas</span><Link href="/issues"><b>{radar.evidence?.reports ?? "Unavailable"}</b> approved player report{radar.evidence?.reports === 1 ? "" : "s"} →</Link></div>
      {flowTotal > 0 ? <section className="obs-flow" aria-labelledby="flow-title"><div><p className="kicker">The weekly scan</p><h3 id="flow-title">From {number(flowTotal)} candidates</h3><p>Processing outcomes over seven days. These counts describe the week’s work, not the current lead total.</p></div><div className="obs-flow-chart"><div className="obs-flow-bar" role="img" aria-label={flowTotal + " candidates reviewed: " + flow.kept + " kept, " + flow.reobserved + " re-observed, " + flow.filtered + " filtered out"}><span className="obs-flow-kept" style={{ width: (flow.kept / flowTotal) * 100 + "%" }} /><span className="obs-flow-recurring" style={{ width: (flow.reobserved / flowTotal) * 100 + "%" }} /><span className="obs-flow-filtered" style={{ width: (flow.filtered / flowTotal) * 100 + "%" }} /></div><dl><div><dt><i className="obs-key-blue" />Kept</dt><dd>{flow.kept}</dd></div><div><dt><i className="obs-key-positive" />Seen again</dt><dd>{flow.reobserved}</dd></div><div><dt><i className="obs-key-muted" />Filtered</dt><dd>{number(flow.filtered)}</dd></div></dl></div></section> : <p className="obs-note">Weekly flow is unavailable because no candidate total is recorded.</p>}
      <details className="obs-method"><summary>What the radar can tell us</summary><p>Tracked leads are the current working set. New leads cover seven days. Repeated sightings can flag recurring topics, but they do not establish how many players are affected.</p></details>
    </section>
  );
}

export function Observatory({ data, radar }: { data: PublicScannerData; radar: PatchRadarData }) {
  return <><ReviewRecord data={data} radar={radar} /><PlatformActivity data={data} /><ScannerRadar radar={radar} /></>;
}
