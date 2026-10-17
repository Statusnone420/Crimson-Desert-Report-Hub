"use client";

import { useState } from "react";
import { ReadingLink } from "./ReadingLink";
import { gapAtTime } from "@/lib/captureGaps";
import { steamPlayerWindow, type SteamPlayerHistory, type SteamPlayerPoint } from "@/lib/steamPlayerHistory";

const number = (value: number) => value.toLocaleString("en-US");
const label = (value: string) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

export function SteamPlayerTimeline({ history }: { history: SteamPlayerHistory }) {
  const [hours, setHours] = useState(24);
  const [selectedAt, setSelectedAt] = useState<string | null>(null);
  // A gap under the pointer, keyed by the capture that opens it.
  const [gapAt, setGapAt] = useState<string | null>(null);
  const window = steamPlayerWindow(history, hours);
  const selected = window.points.find((point) => point.capturedAt === selectedAt) ?? window.points.at(-1);
  const gap = window.gaps.find((item) => item.from.capturedAt === gapAt) ?? null;
  const latest = history.points.at(-1);
  const peak = Math.max(0, ...window.points.map((point) => point.playerCount));
  const power = 10 ** Math.floor(Math.log10(Math.max(1, peak)));
  const ceiling = Math.max(4, Math.ceil(peak / power) * power);
  const x = (point: SteamPlayerPoint) => (Date.parse(point.capturedAt) - window.start) / (window.end - window.start) * 1000;
  const y = (point: SteamPlayerPoint) => 200 - point.playerCount / ceiling * 200;
  const selectAtPointer = (event: { clientX: number; currentTarget: SVGSVGElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const time = window.start + fraction * (window.end - window.start);
    // Eight pixels beside each capture still select it; the rest of a gap reports the gap.
    const openGap = gapAtTime(window.gaps, time, 8 / bounds.width * (window.end - window.start));
    setGapAt(openGap?.from.capturedAt ?? null);
    if (openGap) return;
    const nearest = window.points.reduce<SteamPlayerPoint | undefined>((best, point) => !best || Math.abs(Date.parse(point.capturedAt) - time) < Math.abs(Date.parse(best.capturedAt) - time) ? point : best, undefined);
    if (nearest) setSelectedAt(nearest.capturedAt);
  };
  return (
    <section className="obs-player-record" aria-labelledby="players-title">
      <div className="obs-section-heading"><div><h3 id="players-title">Playing on Steam</h3><p>People in the game, at the moments Steam was checked.</p></div>{latest ? <p>Latest capture: {label(latest.capturedAt)} UTC.{Date.parse(history.checkedAt) - Date.parse(latest.capturedAt) > 3.25 * 3600000 ? " Collection is delayed; this is a historical reading." : ""}</p> : null}</div>
      {history.availability !== "ready" ? <p className="obs-note">{history.availability === "unavailable" ? "Steam player history could not be read. Try again shortly." : "Player-count history is beginning. The first successful collection will appear here; no past counts have been filled in."}</p> : <>
        <div className="obs-review-controls"><span className="obs-player-source">Steam-connected players</span><div className="obs-options" role="group" aria-label="Steam player window">{([24, 168] as const).map((value) => <button type="button" key={value} aria-pressed={hours === value} onClick={() => setHours(value)}>{value === 24 ? "24 hours" : "7 days"}{hours === value ? <span aria-hidden="true" /> : null}</button>)}</div></div>
        {selected ? <>
          <div className={"obs-player-readout" + (gap ? " is-gap" : "")} aria-live="polite">{gap
            ? <><strong>No capture</strong> <span>between {label(gap.from.capturedAt)} and {label(gap.to.capturedAt)} UTC</span></>
            : <><strong>{number(selected.playerCount)} players</strong><span>{label(selected.capturedAt)} UTC</span></>}</div>
          <div className="obs-player-figure">
            <div className="obs-y-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map((tick) => <span key={tick} style={{ top: (1 - tick / 4) * 100 + "%" }}>{number(Math.round(ceiling * tick / 4))}</span>)}</div>
            <div className="obs-player-plot">
              <svg className="obs-player-chart" viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label={`Steam player history. ${window.points.length} captures in the selected ${hours === 24 ? "24-hour" : "seven-day"} window.${window.gaps.length ? ` ${window.gaps.length} ${window.gaps.length === 1 ? "gap" : "gaps"} of more than three hours with no capture.` : ""}`} onPointerMove={selectAtPointer} onClick={selectAtPointer} onPointerLeave={() => setGapAt(null)}>
                {[0, 50, 100, 150, 200].map((tick) => <line key={tick} className="obs-timeline-grid" x1="0" x2="1000" y1={tick} y2={tick} />)}
                {gap ? <rect className="obs-timeline-gap-band" x={x(gap.from)} width={x(gap.to) - x(gap.from)} y="0" height="200" /> : null}
                {window.segments.map((segment) => <polyline key={segment[0].capturedAt} className="obs-timeline-line" points={segment.map((point) => `${x(point)},${y(point)}`).join(" ")} />)}
                {window.gaps.map((item) => <line key={item.from.capturedAt} className={"obs-timeline-gap" + (item === gap ? " is-active" : "")} x1={x(item.from)} y1={y(item.from)} x2={x(item.to)} y2={y(item.to)} />)}
                {gap ? null : <line className="obs-timeline-guide" x1={x(selected)} x2={x(selected)} y1="0" y2="200" />}
              </svg>
              {window.points.map((point) => <span key={point.capturedAt} aria-hidden="true" className={"obs-player-dot" + (point === selected && !gap ? " is-selected" : "")} style={{ left: x(point) / 10 + "%", top: y(point) / 2 + "%" }} />)}
              <div className="obs-player-dates">{[0, 0.5, 1].map((fraction) => <span key={fraction}>{new Date(window.start + fraction * (window.end - window.start)).toLocaleString("en-US", hours === 24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" })}</span>)}</div>
            </div>
          </div>
          <label className="obs-capture-slider"><span>Explore each capture</span><input type="range" min="0" max={window.points.length - 1} value={window.points.indexOf(selected)} step="1" onChange={(event) => { setGapAt(null); setSelectedAt(window.points[Number(event.target.value)].capturedAt); }} aria-label="Choose a Steam player capture" aria-valuetext={`${label(selected.capturedAt)} UTC: ${number(selected.playerCount)} players`} /></label>
          <p className="obs-note">{window.points.length} recorded {window.points.length === 1 ? "capture. A trend needs more than one reading." : `captures. Observed peak: ${number(peak)} players.`} {window.gaps.length ? "A dotted line crosses each gap of more than three hours and fifteen minutes; no count was recorded there. " : ""}These are sampled counts, not continuous coverage.</p>
          <details className="obs-data-table"><summary>Read the Steam player captures</summary><div className="obs-capture-table"><table><caption>Steam-connected players · recorded captures · UTC</caption><thead><tr><th scope="col">Capture</th><th scope="col">Players</th></tr></thead><tbody>{[...window.points].reverse().map((point) => <tr key={point.capturedAt}><th scope="row">{label(point.capturedAt)}</th><td>{number(point.playerCount)}</td></tr>)}</tbody></table></div></details>
        </> : <p className="obs-note" role="status">No player captures in this 24-hour window. Try the seven-day view.</p>}
      </>}
      <p className="obs-note">Steam activity excludes offline play and other platforms. It is separate from Twitch viewers and player reports.</p>
      <ReadingLink variant="quiet" href="https://store.steampowered.com/app/3321460/Crimson_Desert/" target="_blank" rel="noreferrer noopener">View the game on Steam</ReadingLink>
    </section>
  );
}
