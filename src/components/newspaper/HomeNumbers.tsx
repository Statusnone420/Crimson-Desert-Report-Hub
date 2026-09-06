"use client";

import Link from "next/link";
import { useState } from "react";
import type { Category } from "@/lib/constants";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { SteamPulsePoint } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";

const RADAR_LABELS = {
  performance: "Performance",
  crash_startup: "Crashes",
  controls_gameplay: "Gameplay",
  graphics_visual: "Graphics",
  audio: "Audio",
  quest_progression: "Quests",
  other: "Other",
} satisfies Record<Category, string>;

const number = (value: number) => value.toLocaleString("en-US");
const day = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function categoryLabel(category: string, labels: Record<Category, string>) {
  return Object.hasOwn(labels, category) ? labels[category as Category] : category;
}

export function HomeNumbers({ steam, radar, steamUnavailable }: { steam: SteamPulsePoint[]; radar: PatchRadarData | null; steamUnavailable: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const latest = steam.at(-1);
  const changes = steam.filter((point) => point.reviewCountDelta !== null);
  const activePoint = active === null ? null : changes[active];
  const max = Math.max(1, ...changes.map((point) => Math.abs(point.reviewCountDelta ?? 0)));
  const categories = radar?.categories ?? [];
  const radarMax = Math.max(1, ...categories.map((category) => category.tracked));
  const compactRadar = !radar || categories.length === 0;
  const point = (value: number, index: number, radius = 138) => {
    const angle = index * Math.PI * 2 / categories.length - Math.PI / 2;
    return [220 + Math.cos(angle) * value / radarMax * radius, 185 + Math.sin(angle) * value / radarMax * radius];
  };

  return (
    <section id="numbers" className="numbers">
      <p className="eyebrow">The Observatory</p>
      <h2>The game in numbers</h2>
      <div className={`charts${compactRadar ? " charts--compact-radar" : ""}`}>
        <section>
          <h3>Tracked leads by category</h3>
          {radar ? (
            <>
              <p className="small">{number(radar.recurring.trackedLeads)} scanner leads · not confirmed bugs</p>
              {categories.length >= 3 && (
                <svg viewBox="0 0 440 390" role="img" aria-label={`Tracked leads: ${categories.map((category) => `${categoryLabel(category.category, CATEGORY_LABELS)} ${category.tracked}`).join("; ")}`}>
                  <g className="grid">
                    {[1, 2, 3, 4, 5].map((value) => <polygon key={value} points={categories.map((_, index) => point(value * radarMax / 5, index).join(",")).join(" ")} />)}
                    {categories.map((category, index) => <line key={category.category} x1="220" y1="185" x2={point(radarMax, index)[0]} y2={point(radarMax, index)[1]} />)}
                  </g>
                  <polygon className="radar-fill" points={categories.map((category, index) => point(category.tracked, index).join(",")).join(" ")} />
                  {categories.map((category, index) => {
                    const [x, y] = point(category.tracked, index);
                    const [labelX, labelY] = point(radarMax, index, 178);
                    return <g key={category.category}><circle cx={x} cy={y} r="4" /><text x={labelX} y={labelY} textAnchor="middle">{categoryLabel(category.category, RADAR_LABELS)}</text></g>;
                  })}
                </svg>
              )}
              <div className="ranks">
                {categories.map((category) => <div className="rank" key={category.category}><span>{categoryLabel(category.category, CATEGORY_LABELS)}</span><div><i style={{ width: `${category.tracked / radarMax * 100}%` }} /></div><strong>{number(category.tracked)}</strong></div>)}
              </div>
            </>
          ) : <p className="np-error">The scanner record could not be read. Counts are unavailable.</p>}
          <Link className="chart-link" href="/observatory#scanner-radar">Explore the source radar →</Link>
        </section>
        <section>
          <h3>Daily review-count change</h3>
          {steamUnavailable ? <p className="np-error">Steam review history could not be read.</p> : !latest ? <p className="np-error">No Steam review captures are available yet.</p> : (
            <>
              <div className="stats">
                <div><strong>{new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(latest.totalReviews)}</strong><span>Total reviews</span></div>
                <div><strong>{latest.positivePercentage.toFixed(1)}%</strong><span>Positive share</span></div>
              </div>
              <div id="home-review-readout" className="chart-readout" aria-live="polite">
                {activePoint ? <><span>{day(activePoint.snapshotDay)}</span><strong>{(activePoint.reviewCountDelta ?? 0) > 0 ? "+" : ""}{number(activePoint.reviewCountDelta ?? 0)} reviews</strong></> : <span>Focus, hover, or tap a day to read its change.</span>}
              </div>
              <div className="plot">
                <div className="y-axis">{[1, 0.75, 0.5, 0.25, 0].map((value) => <span key={value}>{Math.ceil(value * max)}</span>)}</div>
                <div className="bars">
                  {changes.map((reviewPoint, index) => {
                    const value = reviewPoint.reviewCountDelta ?? 0;
                    return (
                      <button
                        className="bar-column"
                        key={reviewPoint.snapshotDay}
                        aria-label={`${day(reviewPoint.snapshotDay)}: ${value > 0 ? "+" : ""}${value} net reviews`}
                        aria-describedby="home-review-readout"
                        onMouseEnter={() => setActive(index)}
                        onMouseLeave={(event) => { if (event.currentTarget !== document.activeElement) setActive(null); }}
                        onFocus={() => setActive(index)}
                        onBlur={() => setActive(null)}
                        onClick={() => setActive(index)}
                      >
                        <span className="bar" style={{ height: `${Math.abs(value) / max * 100}%`, background: value < 0 ? "var(--red)" : undefined }} />
                        <span className="x-label">{day(reviewPoint.snapshotDay)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="legend">Bar height shows change size. Blue is an increase; red is a decrease.</p>
              <p className="np-capture-note">Latest capture: {new Date(latest.collectedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Reviews are context, not issue evidence.</p>
              <Link className="chart-link" href="/observatory#review-record">Read the review record →</Link>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
