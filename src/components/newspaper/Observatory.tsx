"use client";

import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SteamPlayerTimeline } from "./SteamPlayerTimeline";
import { gapAtTime } from "@/lib/captureGaps";
import type { SteamPlayerHistory } from "@/lib/steamPlayerHistory";
import { useState, type CSSProperties } from "react";
import type { PublicScannerData } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";
import {
  buildRadarCategories,
  buildSteamReviewSeries,
  buildTwitchSeries,
  platformLabels,
  selectSteamReadings,
  selectTwitchWindow,
  twitchHistorySummary,
  reviewMovementAxis,
  reviewWindowChange,
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
  const selectedIndex = points.indexOf(selected);
  const axis = reviewMovementAxis(points.map((point) => point.reviewMovement));
  const patchDay = patch.publishedAt?.slice(0, 10) ?? null;
  const patchIndex = patchDay ? points.findIndex((point) => point.snapshotDay === patchDay) : -1;

  return (
    <>
      <div className="obs-chart-readout">
        <p><span>{displayDate(selected.snapshotDay)}</span><strong>{signed(selected.reviewMovement)} reviews</strong><small>selected reading</small></p>
        <span>{points.length} recorded reading{points.length === 1 ? "" : "s"} · {displayDate(points[0].snapshotDay)}–{displayDate(points.at(-1)?.snapshotDay ?? "")}</span>
      </div>
      <p className="obs-sentiment-readout" aria-live="polite">
        <span><i className="obs-key-positive" />{selected.positiveMovement === null ? "Positive movement unknown" : signed(selected.positiveMovement) + " positive"}</span>
        <span><i className="obs-key-negative" />{selected.negativeMovement === null ? "Negative movement unknown" : signed(selected.negativeMovement) + " negative"}</span>
        <span>Movement is since the previous recorded snapshot.</span>
      </p>
      <div className="obs-review-chart" style={{ "--obs-zero": axis.zero + "%" } as CSSProperties}>
        <div className="obs-y-axis" aria-hidden="true">
          {axis.ticks.map((tick) => <span key={tick} style={{ top: ((axis.max - tick) / (axis.max - axis.min)) * 100 + "%" }}>{signed(tick)}</span>)}
        </div>
        <div className="obs-review-bars">
          <div className="obs-grid-lines" aria-hidden="true">{axis.ticks.map((tick) => <span key={tick} className={tick === 0 ? "is-zero" : ""} style={{ top: ((axis.max - tick) / (axis.max - axis.min)) * 100 + "%" }} />)}</div>
          {points.map((point, index) => {
            const selectedPoint = selected.snapshotDay === point.snapshotDay;
            const delta = point.reviewMovement;
            const height = delta === null ? 0 : (Math.abs(delta) / (axis.max - axis.min)) * 100;
            return (
              <div className="obs-review-column" key={point.snapshotDay}>
                <button
                  type="button"
                  className={"obs-review-hit" + (selectedPoint ? " is-selected" : "")}
                  aria-label={displayDate(point.snapshotDay) + ": " + (delta === null ? "no prior recorded baseline" : signed(delta) + " reviews since the previous recorded snapshot")}
                  aria-pressed={selectedPoint}
                  onPointerMove={(event) => {
                    // A fragment jump can move a bar under a stationary cursor.
                    if (event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0) && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
                      setSelectedDay(point.snapshotDay);
                    }
                  }}
                  onFocus={() => setSelectedDay(point.snapshotDay)}
                  onClick={() => setSelectedDay(point.snapshotDay)}
                >
                  {delta === null ? (
                    <span className="obs-zero-mark" aria-hidden="true" />
                  ) : delta === 0 ? (
                    <span className="obs-zero-mark" aria-hidden="true" />
                  ) : (
                    <span
                      className="obs-movement-bar"
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        height: height + "%",
                        top: delta < 0 ? axis.zero + "%" : undefined,
                        bottom: delta > 0 ? (100 - axis.zero) + "%" : undefined,
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
      <label className="obs-capture-slider"><span>Explore each reading</span><input type="range" min="0" max={points.length - 1} step="1" value={selectedIndex} onChange={(event) => setSelectedDay(points[Number(event.target.value)].snapshotDay)} aria-label="Choose a review reading" aria-valuetext={`${displayDate(selected.snapshotDay)}: ${signed(selected.reviewMovement)} reviews`} /></label>
      <div className="obs-share-days">
        <button type="button" aria-label="Previous review reading" disabled={selectedIndex === 0} onClick={() => setSelectedDay(points[selectedIndex - 1].snapshotDay)}>← Previous</button>
        <span>{displayDate(selected.snapshotDay)} movement</span>
        <button type="button" aria-label="Next review reading" disabled={selectedIndex === points.length - 1} onClick={() => setSelectedDay(points[selectedIndex + 1].snapshotDay)}>Next →</button>
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
  const minimum = Math.max(0, Math.floor(Math.min(...points.map((point) => point.positivePercentage)) - 1));
  const maximum = Math.min(100, Math.ceil(Math.max(...points.map((point) => point.positivePercentage)) + 1));
  const x = (index: number) => (index + 0.5) / points.length * 1000;
  const y = (value: number) => (maximum - value) / (maximum - minimum) * 200;

  return (
    <>
      <div className="obs-chart-readout">
        <p><span>{displayDate(selected.snapshotDay)}</span><strong>{selected.positivePercentage.toFixed(1)}% positive</strong><small>selected reading</small></p>
        <span>{points.length} recorded reading{points.length === 1 ? "" : "s"} · recorded share</span>
      </div>
      <p className="obs-sentiment-readout" aria-live="polite">
        {selected.totalPositive === null || selected.totalNegative === null
          ? <span>Exact positive and negative totals are unknown for this capture.</span>
          : <><span><i className="obs-key-positive" />{number(selected.totalPositive)} positive</span><span><i className="obs-key-negative" />{number(selected.totalNegative)} negative</span></>}
      </p>
      <div className="obs-share-summary">
        <p className="obs-note">All-time positive share at each reading · scale {minimum}–{maximum}%. It counts every review since launch.</p>
        <div className="obs-share-chart">
          <div className="obs-y-axis" aria-hidden="true">{[maximum, (maximum + minimum) / 2, minimum].map((tick, index) => <span key={tick} style={{ top: index * 50 + "%" }}>{tick.toFixed(1)}%</span>)}</div>
          <div className="obs-share-plot">
            <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label={`Positive share across ${points.length} readings, from ${points[0].positivePercentage.toFixed(1)}% to ${points.at(-1)!.positivePercentage.toFixed(1)}%. Vertical scale ${minimum} to ${maximum} percent.`}>
              {[0, 100, 200].map((tick) => <line key={tick} className="obs-timeline-grid" x1="0" x2="1000" y1={tick} y2={tick} />)}
              <polyline className="obs-timeline-line" points={points.map((point, index) => `${x(index)},${y(point.positivePercentage)}`).join(" ")} />
            </svg>
            <div className="obs-share-hits">{points.map((point, index) => <div className="obs-review-column" key={point.snapshotDay}>
              <button type="button" className={"obs-share-hit" + (selectedIndex === index ? " is-selected" : "")} aria-pressed={selectedIndex === index} aria-label={`${displayDate(point.snapshotDay)}: ${point.positivePercentage.toFixed(1)}% positive`} onClick={() => setSelectedDay(point.snapshotDay)} onFocus={() => setSelectedDay(point.snapshotDay)}>
                <span aria-hidden="true" style={{ top: y(point.positivePercentage) / 2 + "%" }} />
              </button>
              <span className={"obs-x-label" + (index % 2 !== 0 && index !== points.length - 1 ? " obs-optional-date" : "")}>{displayDate(point.snapshotDay)}</span>
            </div>)}</div>
          </div>
        </div>
        <div className="obs-balance-track" role="img" aria-label={displayDate(selected.snapshotDay) + ": " + selected.positivePercentage.toFixed(1) + "% positive"}>
          <span style={{ width: selected.positivePercentage + "%" }} />
          <span style={{ width: (100 - selected.positivePercentage) + "%" }} />
        </div>
        <div className="obs-balance-labels"><span>{selected.positivePercentage.toFixed(1)}% positive</span><span>{(100 - selected.positivePercentage).toFixed(1)}% negative · selected reading</span></div>
        <label className="obs-capture-slider"><span>Explore each reading</span><input type="range" min="0" max={points.length - 1} step="1" value={selectedIndex} onChange={(event) => setSelectedDay(points[Number(event.target.value)].snapshotDay)} aria-label="Choose a review reading" aria-valuetext={`${displayDate(selected.snapshotDay)}: ${selected.positivePercentage.toFixed(1)}% positive`} /></label>
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
    const message = series.availability === "unavailable"
      ? "Steam review history could not be read. Try again shortly."
      : "No Steam review captures are available yet.";
    return <section id="review-record" tabIndex={-1} className="obs-section"><div className="obs-section-heading"><div><p className="kicker">Steam reviews</p><h2>The review record</h2></div></div><p className={series.availability === "unavailable" ? "np-error" : "obs-note"}>{message}</p></section>;
  }
  const points = selectSteamReadings(series.points, readingCount);
  const latest = series.points.at(-1) ?? null;
  if (!latest) return null;
  const change = reviewWindowChange(points);

  return (
    <section id="review-record" tabIndex={-1} className="obs-section" aria-labelledby="review-title">
      <div className="obs-section-heading"><div><p className="kicker">Steam reviews</p><h2 id="review-title">The review record</h2></div><div className="obs-review-totals"><span><strong>{number(latest.totalReviews)}</strong> total reviews</span><span><strong>{latest.positivePercentage.toFixed(1)}%</strong> positive share, all time</span></div></div>
      {change ? <p className="obs-window-summary">Between <b>{displayDate(points[0].snapshotDay)}</b> and <b>{displayDate(points.at(-1)!.snapshotDay)}</b>, the recorded total changed by <strong>{signed(change.reviews)} reviews</strong>. Positive share {Math.abs(change.positiveShare) < 0.05 ? "was unchanged at the displayed precision" : `changed by ${signed(Number(change.positiveShare.toFixed(1)))} percentage points`}.</p> : null}
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
  // A gap under the pointer, keyed by the capture that opens it.
  const [gapAt, setGapAt] = useState<string | null>(null);
  const [capturePage, setCapturePage] = useState(0);
  const series = buildTwitchSeries(data.platformContext, data.pulseReadFailures.includes("platform"));
  const window = selectTwitchWindow(series, hours);
  const historySummary = twitchHistorySummary(series);
  if (!window) {
    return <div className="obs-audience"><p className="np-error">{historySummary ?? "No complete Twitch captures are available in this window."}</p></div>;
  }
  const controls = (
    <div key="controls" className="obs-review-controls">
      {window.points.length > 0 ? <Options key="metric" label="Twitch metric" value={metric} onChange={(value) => setMetric(value === "streams" ? "streams" : "viewers")} options={[["viewers", "Viewers"], ["streams", "Streams"]]} /> : null}
      <Options key="window" label="Twitch window" value={hours} onChange={(value) => { setHours(Number(value)); setSelectedCapture(null); setGapAt(null); setCapturePage(0); }} options={[[24, "24 hours"], [168, "7 days"]]} />
    </div>
  );
  if (window.points.length === 0) {
    return (
      <div className="obs-audience">
        <div className="obs-audience-heading"><span className="obs-platform-name">Twitch</span><span>No captures in this window</span></div>
        <p className="obs-note">{historySummary ? historySummary + " " : ""}{series.latestCapturedAt ? "Latest complete capture: " + captureLabel(series.latestCapturedAt) + " UTC." : ""}</p>
        {controls}
        <p className="obs-note" role="status">No complete Twitch captures are available in this {hours === 24 ? "24-hour" : "seven-day"} window.</p>
      </div>
    );
  }

  const points = window.points;
  const selected = points.find((point) => point.capturedAt === selectedCapture) ?? points.at(-1) ?? null;
  if (!selected) return null;
  const gap = window.gaps.find((item) => item.from.capturedAt === gapAt) ?? null;
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
    // Captures sit between x = 45 and 685 of the 710-unit drawing, so the pointer
    // is read against that band; the whole width would shift it off the dots.
    const plotWidth = bounds.width * 640 / 710;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left - bounds.width * 45 / 710) / plotWidth));
    const time = window.start + ratio * (window.end - window.start);
    // Eight pixels beside each capture still select it; the rest of a gap reports the gap.
    const openGap = gapAtTime(window.gaps, time, 8 / plotWidth * (window.end - window.start));
    setGapAt(openGap?.from.capturedAt ?? null);
    if (openGap) return;
    const nearest = points.reduce((best, point) => Math.abs(new Date(point.capturedAt).getTime() - time) < Math.abs(new Date(best.capturedAt).getTime() - time) ? point : best);
    setSelectedCapture(nearest.capturedAt);
  };
  const captureSpan = displayDate(points[0].capturedAt) + "–" + displayDate(points.at(-1)?.capturedAt ?? "");

  return (
    <div className="obs-audience">
      <div className="obs-audience-heading"><span className="obs-platform-name">Twitch</span><span>{points.length} recorded captures · UTC</span></div>
      <p className="obs-note">{historySummary ? historySummary + " " : ""}Latest complete capture: {captureLabel(series.latestCapturedAt ?? latest.capturedAt)} UTC.</p>
      <div className="obs-audience-numbers"><div><strong>{number(latest.viewers)}</strong><span>Viewers at latest capture</span></div><div><strong>{number(latest.streams)}</strong><span>Live streams at latest capture</span></div></div>
      {controls}
      <div className={"obs-twitch-readout" + (gap ? " is-gap" : "")} aria-live="polite">{gap
        ? <><strong>No capture</strong> <span>between {captureLabel(gap.from.capturedAt)} and {captureLabel(gap.to.capturedAt)} UTC</span></>
        : <><strong>{number(selected[metric])} {metric}</strong><span>{captureLabel(selected.capturedAt)} UTC</span></>}</div>
      <svg className="obs-twitch-chart" viewBox="0 0 710 265" role="img" aria-label={(hours === 24 ? "24-hour" : "Seven-day") + " Twitch " + metric + " history. " + points.length + " recorded captures from " + captureSpan + ", observed low " + low + ", observed peak " + peak + "." + (window.gaps.length ? " " + window.gaps.length + (window.gaps.length === 1 ? " gap" : " gaps") + " of more than three hours with no capture." : "")} onPointerMove={selectAtPointer} onClick={selectAtPointer} onPointerLeave={() => setGapAt(null)}>
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line className="obs-timeline-grid" x1="45" x2="685" y1={220 - tick * 47.5} y2={220 - tick * 47.5} /><text x="35" y={224 - tick * 47.5} textAnchor="end">{number((ceiling * tick) / 4)}</text></g>)}
        {gap ? <rect className="obs-timeline-gap-band" x={x(gap.from)} width={x(gap.to) - x(gap.from)} y="20" height="200" /> : null}
        {window.segments.map((segment) => <polyline className="obs-timeline-line" key={segment[0].capturedAt} points={segment.map((point) => x(point) + "," + y(point)).join(" ")} />)}
        {window.gaps.map((item) => <line key={item.from.capturedAt} className={"obs-timeline-gap" + (item === gap ? " is-active" : "")} x1={x(item.from)} y1={y(item.from)} x2={x(item.to)} y2={y(item.to)} />)}
        {points.map((point) => <circle className="obs-timeline-dot" key={point.capturedAt} cx={x(point)} cy={y(point)} r="2" />)}
        {gap ? null : <><line className="obs-timeline-guide" x1={x(selected)} x2={x(selected)} y1="20" y2="220" /><circle className="obs-timeline-selected" cx={x(selected)} cy={y(selected)} r="5" /></>}
        {[0, 0.5, 1].map((fraction) => <text key={fraction} x={45 + fraction * 640} y="252" textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{new Date(window.start + fraction * (window.end - window.start)).toLocaleString("en-US", hours === 24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" })}</text>)}
      </svg>
      <label className="obs-capture-slider"><span>Explore each capture</span><input type="range" min="0" max={points.length - 1} step="1" value={selectedIndex} onChange={(event) => { setGapAt(null); setSelectedCapture(points[Number(event.target.value)].capturedAt); }} aria-label="Choose a Twitch capture" aria-valuetext={captureLabel(selected.capturedAt) + " UTC: " + selected[metric] + " " + metric} /></label>
      <div className="obs-range-facts"><span><b>{number(low)}</b> observed low</span><span><b>{number(peak)}</b> observed peak</span><span><b>{signed(latest[metric] - points[0][metric])}</b> first to last</span></div>
      <p className="obs-note">{window.gaps.length ? "A dotted line joins captures more than three hours and fifteen minutes apart; no audience was recorded between them. " : ""}These are {points.length} available captures from {captureSpan}; a requested 7-day window does not imply seven days of complete coverage. Viewers and streams are audience activity, not player counts.</p>
      <details className="obs-twitch-values"><summary>Read the Twitch captures</summary><div className="obs-capture-table"><table><caption>Recorded Twitch aggregates · UTC · newest first</caption><thead><tr><th scope="col">Capture</th><th scope="col">Viewers</th><th scope="col">Streams</th></tr></thead><tbody>{visibleCaptures.map((point) => <tr key={point.capturedAt}><th scope="row">{captureLabel(point.capturedAt)}</th><td>{number(point.viewers)}</td><td>{number(point.streams)}</td></tr>)}</tbody></table></div>{points.length > pageSize ? <div className="obs-capture-pages"><button type="button" disabled={capturePage === 0} onClick={() => setCapturePage((page) => page - 1)}>← Newer captures</button><span aria-live="polite">{capturePage * pageSize + 1}–{Math.min((capturePage + 1) * pageSize, points.length)} of {points.length}</span><button type="button" disabled={(capturePage + 1) * pageSize >= points.length} onClick={() => setCapturePage((page) => page + 1)}>Older captures →</button></div> : null}</details>
    </div>
  );
}

function PlatformActivity({ data, players }: { data: PublicScannerData; players: SteamPlayerHistory }) {
  const platforms = platformLabels(data);
  const context = data.platformContext;
  const recordedAt = context?.igdbCapturedAt ?? (context?.igdbStatus === "ok" ? context.capturedAt : null);
  const refreshMissed = Boolean(recordedAt && recordedAt !== context?.capturedAt);
  const unavailable = data.pulseReadFailures.includes("platform")
    ? "The platform record could not be read. Try again shortly."
    : context?.igdbStatus === "absent"
      ? "The latest IGDB lookup did not find the game. No earlier platform list is available."
      : "No platform list is available from IGDB yet.";
  return (
    <section id="platform-activity" tabIndex={-1} className="obs-section" aria-labelledby="platform-title">
      <div className="obs-section-heading"><div><p className="kicker">Platform activity</p><h2 id="platform-title">Beyond the game window</h2></div><p>Twitch audiences, Steam players, and the game’s listed platforms.</p></div>
      <div className="obs-platform-spread">
        <TwitchTimeline data={data} />
        <aside className="obs-platforms">
          <p className="kicker">The platform record</p><h3>Where the game is listed</h3>
          {platforms?.length ? <ul>{platforms.map((platform) => <li key={platform}>{platform}</li>)}</ul> : <p>{unavailable}</p>}
          {platforms?.length && recordedAt ? <p className="obs-platform-date">Last listed {captureLabel(recordedAt)} UTC.{refreshMissed ? " The latest check did not refresh this list; the previous record is shown." : ""}</p> : null}
          <p>Base-game platforms come from IGDB. Player totals for these platforms are not included in this record.</p>
          {platforms?.length && context?.igdbUrl ? <ReadingLink variant="source" source="IGDB · Game directory" href={context.igdbUrl} target="_blank" rel="noreferrer noopener">View on IGDB</ReadingLink> : null}
        </aside>
      </div>
      <SteamPlayerTimeline history={players} />
    </section>
  );
}

function WeeklyScan({ radar }: { radar: PatchRadarData }) {
  const [metric, setMetric] = useState("both");
  const [daysToShow, setDaysToShow] = useState(7);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const days = radar.daily.slice(-daysToShow);
  const selected = days.find((point) => point.day === selectedDay) ?? days.at(-1);
  const selectedIndex = selected ? days.indexOf(selected) : 0;
  const count = (point: PatchRadarData["daily"][number]) => metric === "kept" ? point.newLeads : metric === "seen" ? point.reobservations : point.newLeads + point.reobservations;
  const axis = reviewMovementAxis(days.map(count));
  const flow = radar.funnel7d;
  const end = radar.daily.at(-1)?.day;
  const start = end ? new Date(Date.parse(end + "T00:00:00Z") - 7 * 86400000).toISOString() : null;
  const outcomes = [
    { label: "Kept", value: flow.kept, color: "obs-flow-kept", description: "New lead records retained during scans." },
    { label: "Seen again", value: flow.reobserved, color: "obs-flow-recurring", description: "Recorded repeat observations of existing leads." },
    { label: "Not retained", value: flow.filtered, color: "obs-flow-filtered", description: "No new lead or repeat observation recorded, including incomplete processing." },
  ];
  return (
    <section className="obs-scan" aria-labelledby="flow-title">
      <div className="obs-section-heading">
        <div><h3 id="flow-title">The weekly scan</h3><p>{number(flow.reviewed)} candidates recorded{start && end ? ` · ${displayDate(start)}–${displayDate(end)}` : ""} · rolling seven days</p></div>
        <p>Recorded lead outcomes. Candidate totals do not prove processing completed.</p>
      </div>
      {flow.reviewed > 0 ? <>
        <div className="obs-outcome-strip" role="img" aria-label={`${flow.reviewed} candidates recorded: ${flow.kept} kept, ${flow.reobserved} seen again, ${flow.filtered} not retained, including incomplete processing.`}>
          {outcomes.map((outcome) => <span key={outcome.label} className={outcome.color} style={{ width: outcome.value / flow.reviewed * 100 + "%" }} />)}
        </div>
        <dl className="obs-scan-outcomes">{outcomes.map((outcome) => <div key={outcome.label}>
          <dt><i className={outcome.color} />{outcome.label}</dt><dd>{number(outcome.value)} <span>{(outcome.value / flow.reviewed * 100).toFixed(1)}%</span><p>{outcome.description}</p></dd>
        </div>)}</dl>
      </> : <p className="obs-note">No candidate total is recorded for this seven-day window.</p>}
      {selected ? <div className="obs-scan-explorer">
        <div className="obs-review-controls">
          <Options label="Scan outcomes" value={metric} onChange={(value) => setMetric(String(value))} options={[["both", "Both"], ["kept", "Kept"], ["seen", "Seen again"]]} />
          <Options label="Scan history" value={daysToShow} onChange={(value) => setDaysToShow(Number(value))} options={[[7, "7 days"], [30, "30 days"]]} />
        </div>
        <div className="obs-chart-readout" aria-live="polite"><p><span>{displayDate(selected.day)} · selected UTC day</span><strong>{number(count(selected))} recorded {count(selected) === 1 ? "outcome" : "outcomes"}</strong></p><span>{number(selected.newLeads)} kept · {number(selected.reobservations)} seen again</span></div>
        <div className="obs-review-chart obs-scan-chart">
          <div className="obs-y-axis" aria-hidden="true">{axis.ticks.map((tick) => <span key={tick} style={{ top: (1 - tick / axis.max) * 100 + "%" }}>{number(tick)}</span>)}</div>
          <div className="obs-review-bars">
            <div className="obs-grid-lines" aria-hidden="true">{axis.ticks.map((tick) => <span key={tick} className={tick === 0 ? "is-zero" : ""} style={{ top: (1 - tick / axis.max) * 100 + "%" }} />)}</div>
            {days.map((point, index) => <div className="obs-review-column" key={point.day}>
              <button type="button" className={"obs-scan-hit" + (point.day === selected.day ? " is-selected" : "")} aria-label={`${displayDate(point.day)}: ${point.newLeads} kept, ${point.reobservations} seen again`} aria-pressed={point.day === selected.day} onFocus={() => setSelectedDay(point.day)} onClick={() => setSelectedDay(point.day)}>
                <span className="obs-scan-stack" aria-hidden="true" style={{ height: count(point) / axis.max * 100 + "%" }}>
                  {metric !== "seen" ? <i className="obs-flow-kept" style={{ flex: point.newLeads }} /> : null}
                  {metric !== "kept" ? <i className="obs-flow-recurring" style={{ flex: point.reobservations }} /> : null}
                </span>
              </button>
              <span className={"obs-x-label" + (index !== 0 && index !== days.length - 1 && index % Math.ceil(days.length / 7) !== 0 ? " obs-date-hidden" : index % 2 !== 0 && index !== days.length - 1 ? " obs-optional-date" : "")}>{displayDate(point.day)}</span>
            </div>)}
          </div>
        </div>
        <label className="obs-capture-slider"><span>Explore each day</span><input type="range" min="0" max={days.length - 1} step="1" value={selectedIndex} onChange={(event) => setSelectedDay(days[Number(event.target.value)].day)} aria-label="Choose a scan day" aria-valuetext={`${displayDate(selected.day)}: ${selected.newLeads} kept, ${selected.reobservations} seen again`} /></label>
        <p className="obs-note"><i className="obs-key-blue" />Kept <i className="obs-key-positive" />Seen again · {days.length} UTC {days.length === 1 ? "date" : "dates"} available, {displayDate(days[0].day)}–{displayDate(days.at(-1)!.day)}. History begins at the current patch or the last 30 days, whichever is later. The first and latest dates can be partial. Zero means no recorded outcome; it does not prove a scan ran.</p>
        <details className="obs-data-table"><summary>Read the scan values</summary><table><caption>Recorded scan outcomes · UTC dates</caption><thead><tr><th scope="col">Date</th><th scope="col">Kept</th><th scope="col">Seen again</th></tr></thead><tbody>{days.map((point) => <tr key={point.day}><th scope="row">{displayDate(point.day)}</th><td>{number(point.newLeads)}</td><td>{number(point.reobservations)}</td></tr>)}</tbody></table></details>
      </div> : null}
      <details className="obs-method"><summary>Why kept leads and new tracked leads differ</summary><p>Kept counts new records from scans during the week. The radar above counts only leads still eligible for the current patch. Records can later be hidden or fall outside that patch. Repeat observations are processing events, not additional unique leads. These counts are not confirmed bugs or player reports.</p></details>
    </section>
  );
}

function ScannerRadar({ radar }: { radar: PatchRadarData }) {
  const [metric, setMetric] = useState<"tracked" | "newThisWeek">("tracked");
  const [active, setActive] = useState(0);
  const series = buildRadarCategories(radar);
  if (series.availability !== "ready") {
    return <section id="scanner-radar" tabIndex={-1} className="obs-section"><div className="obs-section-heading"><div><p className="kicker">The source radar</p><h2>What keeps showing up?</h2></div></div><p className="np-error">Radar category data is unavailable because no recorded category counts are available.</p></section>;
  }
  const categories = series.categories;
  const selected = categories[Math.min(active, categories.length - 1)];
  const maximum = niceAxisMaximum(Math.max(1, ...categories.map((category) => category[metric])));
  const total = categories.reduce((sum, category) => sum + category[metric], 0);
  const point = (value: number, index: number, radius = 142): [number, number] => {
    const angle = (index * Math.PI * 2) / categories.length - Math.PI / 2;
    return [220 + Math.cos(angle) * value / maximum * radius, 192 + Math.sin(angle) * value / maximum * radius];
  };

  return (
    <section id="scanner-radar" tabIndex={-1} className="obs-section" aria-labelledby="radar-title">
      <div className="obs-section-heading"><div><p className="kicker">The source radar</p><h2 id="radar-title">What keeps showing up?</h2></div><Options label="Radar count" value={metric} onChange={(value) => setMetric(value === "newThisWeek" ? "newThisWeek" : "tracked")} options={[["tracked", "Tracked leads"], ["newThisWeek", "New this week"]]} /></div>
      <div className="obs-radar-spread">
        <div className="obs-radar-figure"><p><strong>{total}</strong> {metric === "tracked" ? "tracked leads" : "new leads in seven days"} <span>· not confirmed bugs</span></p><svg viewBox="0 0 440 395" role="img" aria-label={(metric === "tracked" ? "Tracked leads" : "New leads this week") + " by category. " + categories.map((category) => category.label + ": " + category[metric]).join("; ")}><g className="obs-radar-grid">{[1, 2, 3, 4, 5].map((step) => <polygon key={step} points={categories.map((_, index) => point(step * maximum / 5, index).join(",")).join(" ")} />)}{categories.map((_, index) => <line key={index} x1="220" y1="192" x2={point(maximum, index)[0]} y2={point(maximum, index)[1]} />)}</g><polygon className="obs-radar-shape" points={categories.map((category, index) => point(category[metric], index).join(",")).join(" ")} />{categories.map((category, index) => { const current = point(category[metric], index); const label = point(maximum, index, 179); return <g key={category.category}><circle cx={current[0]} cy={current[1]} r={active === index ? 6 : 3} className={active === index ? "obs-radar-active" : ""} /><text x={label[0]} y={label[1]} textAnchor="middle">{category.short}</text></g>; })}{[1, 2, 3, 4, 5].map((step) => <text className="obs-radar-scale" key={step} x="207" y={192 - step / 5 * 142}>{step * maximum / 5}</text>)}</svg></div>
        <div className="obs-radar-ranking"><div className="obs-rank-labels"><span>Category</span><span>{metric === "tracked" ? "Tracked" : "New in 7 days"}</span></div>{categories.map((category, index) => <button type="button" className={"obs-rank-row" + (active === index ? " is-selected" : "")} key={category.category} aria-pressed={active === index} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}><span>{category.label}</span><span className="obs-rank-track"><i style={{ width: (category[metric] / maximum) * 100 + "%" }} /></span><strong>{category[metric]}</strong></button>)}<p className="obs-rank-readout" aria-live="polite"><b>{selected.label}</b> · {selected.tracked} tracked · {selected.newThisWeek} new this week</p></div>
      </div>
      <div className="obs-radar-foot"><span><b>{radar.recurring.recurringLeads}</b> of {radar.recurring.trackedLeads} tracked leads seen again</span><span><b>{radar.activeLeadClusters}</b> mapped issue areas</span><ReadingLink variant="quiet" href="/issues"><b>{radar.evidence?.reports ?? "Unavailable"}</b> approved player report{radar.evidence?.reports === 1 ? "" : "s"} in this patch family</ReadingLink></div>
      <WeeklyScan radar={radar} />
      <details className="obs-method"><summary>What the radar can tell us</summary><p>Tracked leads are the current working set. New leads cover seven days. Repeated sightings can flag recurring topics, but they do not establish how many players are affected.</p></details>
    </section>
  );
}

export function Observatory({ data, radar, players }: { data: PublicScannerData; radar: PatchRadarData; players: SteamPlayerHistory }) {
  return <><ReviewRecord data={data} radar={radar} /><PlatformActivity data={data} players={players} /><ScannerRadar radar={radar} /></>;
}
