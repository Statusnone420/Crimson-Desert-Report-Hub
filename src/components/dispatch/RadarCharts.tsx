import type { ActivityDay } from "@/lib/activitySeries";
import type { RadarRecurrencePoint, RadarWeeklyPoint } from "@/lib/radar.server";

/**
 * Editorial Dispatch chart primitives for the Patch Radar work. All charts are
 * server-rendered SVG or rule-styled divs: no chart library, no animation, no
 * decorative color. Evidence series keep the existing crimson/ink fills; radar
 * intelligence series use the blue lead register. The two never share a lane.
 */

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

/**
 * Diverging daily chart: player evidence above the axis, radar intelligence
 * below it. Each lane scales to its own per-day peak — the peak numerals on
 * the left edge state each lane's scale so the lanes are never read as one.
 */
export function DivergingActivityChart({
  series,
  width,
  laneHeight,
  maxDays,
  barWidth,
  leftPad,
  labelsInSvg,
}: {
  series: ActivityDay[];
  width: number;
  laneHeight: number;
  maxDays: number;
  barWidth: number;
  leftPad: number;
  labelsInSvg: boolean;
}) {
  const shown = series.slice(-maxDays);
  const count = Math.max(shown.length, 1);
  const pitch = Math.min(80, Math.floor((width - leftPad * 2) / count));
  const barW = Math.min(barWidth, Math.max(4, Math.floor((pitch - 4) / 2)));
  const evidenceMax = Math.max(1, ...shown.map((day) => Math.max(day.reports, day.taps)));
  const radarMax = Math.max(1, ...shown.map((day) => Math.max(day.newLeads, day.reobservations)));
  const kE = laneHeight / evidenceMax;
  const kR = laneHeight / radarMax;
  const scaled = (value: number, k: number) => (value <= 0 ? 0 : Math.max(1, Math.round(value * k)));
  const axisY = laneHeight;
  const labelArea = labelsInSvg ? 22 : 4;
  const height = laneHeight * 2 + labelArea;
  const labelIndexes = new Set([0, Math.floor((count - 1) / 2), count - 1]);

  const totals = shown.reduce(
    (sum, day) => ({
      reports: sum.reports + day.reports,
      taps: sum.taps + day.taps,
      newLeads: sum.newLeads + day.newLeads,
      reobservations: sum.reobservations + day.reobservations,
    }),
    { reports: 0, taps: 0, newLeads: 0, reobservations: 0 },
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pulse-chart"
      role="img"
      aria-label={`Daily activity across ${shown.length} days. Player evidence above the line: ${totals.reports} structured reports and ${totals.taps} one-tap confirmations. Radar intelligence below the line: ${totals.newLeads} new kept leads and ${totals.reobservations} re-observations. The two registers are charted separately and never combined.`}
    >
      {/* Central axis: the visual boundary between evidence and intelligence. */}
      <line x1="0" y1={axisY} x2={width} y2={axisY} stroke="rgba(236,227,208,0.28)" strokeWidth="1" />
      {/* Per-lane peak numerals: each lane carries its own scale, stated. */}
      <text x={0} y={10} fontFamily="var(--font-mono)" fontSize="10" fill="var(--dispatch-quiet)">
        {evidenceMax}
      </text>
      <text
        x={0}
        y={axisY + laneHeight - 2}
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill="var(--dispatch-quiet)"
      >
        {radarMax}
      </text>
      {shown.map((day, index) => {
        const x = leftPad + index * pitch;
        const tapsH = scaled(day.taps, kE);
        const reportsH = scaled(day.reports, kE);
        const reobsH = scaled(day.reobservations, kR);
        const leadsH = scaled(day.newLeads, kR);
        return (
          <g key={day.day}>
            {tapsH > 0 ? (
              <rect x={x} y={axisY - tapsH} width={barW} height={tapsH} fill="var(--bar-taps)" />
            ) : null}
            {reportsH > 0 ? (
              <rect x={x + barW + 2} y={axisY - reportsH} width={barW} height={reportsH} fill="var(--bar-reports)" />
            ) : null}
            {reobsH > 0 ? (
              <rect x={x} y={axisY + 1} width={barW} height={reobsH} fill="var(--bar-reobs)" />
            ) : null}
            {leadsH > 0 ? (
              <rect x={x + barW + 2} y={axisY + 1} width={barW} height={leadsH} fill="var(--bar-leads)" />
            ) : null}
            {labelsInSvg && labelIndexes.has(index) ? (
              <text
                x={x}
                y={height - 6}
                fontFamily="var(--font-mono)"
                fontSize="10.5"
                fill="var(--dispatch-quiet)"
              >
                {shortDate(day.day)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function ActivityDataTable({ series, maxDays }: { series: ActivityDay[]; maxDays: number }) {
  const shown = series.slice(-maxDays);
  return (
    <div className="sr-only">
      <table aria-label="Daily activity by day: player evidence and radar intelligence as separate series">
        <caption>
          Daily activity by day. Reports and confirmations are player evidence; new leads and re-observations are
          scanner intelligence and never count as evidence.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Structured reports</th>
            <th scope="col">One-tap confirmations</th>
            <th scope="col">New radar leads</th>
            <th scope="col">Radar re-observations</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>{day.reports}</td>
              <td>{day.taps}</td>
              <td>{day.newLeads}</td>
              <td>{day.reobservations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

export type RadarScreenSector = { category: string; label: string; color: string };

/**
 * The radar screen: a polar field of tracked leads. Each SECTOR is a problem
 * area (equal sweep, fixed category order, labeled at the rim with its hue
 * carried by the rim arc, never the label text). Each BLIP is one lead —
 * distance from center is how recently the scanner saw it (center = today,
 * rim = the recency cap), blip area grows with times seen, and published
 * leads are solid while private ones are hollow outlines. Position carries
 * identity, so the six hues are decoration on top of a colorblind-safe chart.
 * Blips carry no text: category, counts, and scanner-day offsets only.
 */
export function RadarScreen({
  points,
  sectors,
  size,
}: {
  points: RadarRecurrencePoint[];
  sectors: RadarScreenSector[];
  size: number;
}) {
  if (points.length === 0 || sectors.length === 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const labelSpace = 18;
  const rOuter = size / 2 - labelSpace - 8;
  const rInner = 30;
  const dayCap = Math.max(7, Math.min(28, Math.max(...points.map((p) => p.daysSinceSeen))));
  const sweep = (Math.PI * 2) / sectors.length;
  const sectorStart = (index: number) => -Math.PI / 2 + index * sweep;
  const sectorIndex = new Map(sectors.map((sector, index) => [sector.category, index]));

  const bySector = new Map<string, RadarRecurrencePoint[]>();
  for (const point of points) {
    if (!sectorIndex.has(point.category)) continue;
    const list = bySector.get(point.category) ?? [];
    list.push(point);
    bySector.set(point.category, list);
  }
  // Deterministic layout: order blips inside a sector by recency then weight.
  for (const list of bySector.values()) {
    list.sort((a, b) => a.daysSinceSeen - b.daysSinceSeen || b.seenCount - a.seenCount);
  }
  const summary = sectors
    .map((sector) => `${sector.label} ${bySector.get(sector.category)?.length ?? 0}`)
    .join(", ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="radar-screen"
      role="img"
      aria-label={`Radar screen: ${points.length} tracked leads plotted by problem area and recency. Fresh leads sit near the center; leads not seen for ${dayCap} days or more sit at the rim. Solid blips are published, hollow blips are private. By area: ${summary}.`}
    >
      {/* Range rings: recency guides, center = seen today. */}
      {[rInner, rInner + (rOuter - rInner) / 2, rOuter].map((radius) => (
        <circle
          key={radius}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(236,227,208,0.13)"
          strokeWidth="1"
        />
      ))}
      {/* Sector dividers and rim arcs (the hue lives on the arc, not the text). */}
      {sectors.map((sector, index) => {
        const start = sectorStart(index);
        const end = start + sweep;
        const pDiv = polar(cx, cy, rOuter, start);
        const pIn = polar(cx, cy, rInner, start);
        const arcPad = sectors.length > 1 ? 0.02 : 0;
        const a0 = polar(cx, cy, rOuter + 4, start + arcPad);
        const a1 = polar(cx, cy, rOuter + 4, end - arcPad);
        const mid = start + sweep / 2;
        // Labels run tangentially around the rim (rotated, kept upright) so
        // long category names never clip at the viewBox edges.
        const labelPos = polar(cx, cy, rOuter + 12, mid);
        const rawDeg = ((((mid * 180) / Math.PI + 90) % 360) + 360) % 360;
        const labelDeg = rawDeg > 90 && rawDeg < 270 ? rawDeg - 180 : rawDeg;
        return (
          <g key={sector.category}>
            <line
              x1={pIn.x.toFixed(1)}
              y1={pIn.y.toFixed(1)}
              x2={pDiv.x.toFixed(1)}
              y2={pDiv.y.toFixed(1)}
              stroke="rgba(236,227,208,0.13)"
              strokeWidth="1"
            />
            <path
              d={`M ${a0.x.toFixed(1)} ${a0.y.toFixed(1)} A ${rOuter + 4} ${rOuter + 4} 0 ${sweep - arcPad * 2 > Math.PI ? 1 : 0} 1 ${a1.x.toFixed(1)} ${a1.y.toFixed(1)}`}
              fill="none"
              stroke={sector.color}
              strokeWidth="3"
            />
            <text
              x={labelPos.x.toFixed(1)}
              y={labelPos.y.toFixed(1)}
              transform={`rotate(${labelDeg.toFixed(1)} ${labelPos.x.toFixed(1)} ${labelPos.y.toFixed(1)})`}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="var(--font-mono)"
              fontSize="9.5"
              letterSpacing="0.06em"
              fill="var(--dispatch-quiet)"
            >
              {sector.label.toUpperCase()}
            </text>
          </g>
        );
      })}
      {/* Blips: one per tracked lead. */}
      {sectors.map((sector, index) => {
        const list = bySector.get(sector.category) ?? [];
        const start = sectorStart(index);
        return list.map((point, j) => {
          const angle = start + sweep * (0.14 + (0.72 * (j + 0.5)) / list.length);
          const radius = rInner + (Math.min(point.daysSinceSeen, dayCap) / dayCap) * (rOuter - rInner - 6);
          const pos = polar(cx, cy, radius, angle);
          const blipR = Math.max(2.5, Math.min(9, 2.5 * Math.sqrt(point.seenCount)));
          const seenLabel =
            point.daysSinceSeen === 0 ? "seen today" : `seen ${point.daysSinceSeen}d ago`;
          return (
            <circle
              key={`${sector.category}-${j}`}
              cx={pos.x.toFixed(1)}
              cy={pos.y.toFixed(1)}
              r={blipR.toFixed(1)}
              fill={point.isPublic ? sector.color : "none"}
              stroke={sector.color}
              strokeWidth={point.isPublic ? 0 : 1.8}
              opacity={point.isPublic ? 1 : 0.9}
            >
              <title>{`${sector.label} lead · ${seenLabel} · seen ${point.seenCount}× total${point.isPublic ? " · published" : " · private"}`}</title>
            </circle>
          );
        });
      })}
      {/* Center: the "now" hub. */}
      <circle cx={cx} cy={cy} r={rInner - 8} fill="rgba(17,14,11,0.85)" />
      <text
        x={cx}
        y={cy - 1}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="18"
        fill="var(--dispatch-ink)"
      >
        {points.length}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="8.5"
        letterSpacing="0.1em"
        fill="var(--dispatch-quiet)"
      >
        TRACKED
      </text>
    </svg>
  );
}

/**
 * Proportional funnel: one horizontal bar split into kept / re-observed /
 * filtered shares of everything reviewed in the window.
 */
export function SegmentedFunnelBar({
  reviewed,
  kept,
  reobserved,
  filtered,
}: {
  reviewed: number;
  kept: number;
  reobserved: number;
  filtered: number;
}) {
  if (reviewed <= 0) return null;
  const pct = (value: number) => Math.max(0, Math.min(100, (value / reviewed) * 100));
  return (
    <div
      className="funnel-bar-wrap"
      role="img"
      aria-label={`Of ${reviewed} candidates reviewed, ${kept} were kept as new leads, ${reobserved} were re-observations of known leads, and ${filtered} were filtered out.`}
    >
      <div className="funnel-bar">
        <div className="funnel-bar__kept" style={{ width: `${pct(kept)}%` }} />
        <div className="funnel-bar__reobs" style={{ width: `${pct(reobserved)}%` }} />
        <div className="funnel-bar__filtered" style={{ width: `${pct(filtered)}%` }} />
      </div>
      <div className="funnel-bar__labels">
        <span className="funnel-bar__label--kept">{kept} kept</span>
        <span className="funnel-bar__label--reobs">{reobserved} re-observed</span>
        <span className="funnel-bar__label--filtered">{filtered} filtered</span>
      </div>
    </div>
  );
}

export type ChartCategory = { category: string; label: string; color: string };

/**
 * Weekly stacked columns: working-set composition by first-seen week. Segment
 * colors are the fixed category hues in fixed order (bottom-up), separated by
 * 2px surface gaps; the peak numeral states the tallest week's total.
 */
export function WeeklyStackedColumns({
  weeks,
  categories,
  width,
  height,
}: {
  weeks: RadarWeeklyPoint[];
  categories: ChartCategory[];
  width: number;
  height: number;
}) {
  if (weeks.length === 0) return null;
  const totals = weeks.map((week) => Object.values(week.counts).reduce((sum, n) => sum + n, 0));
  const peak = Math.max(1, ...totals);
  const padT = 16;
  const padB = 18;
  const plotH = height - padT - padB;
  const pitch = Math.min(72, Math.floor(width / weeks.length));
  const colW = Math.min(36, Math.max(10, pitch - 12));
  const unit = plotH / peak;
  const grand = totals.reduce((sum, n) => sum + n, 0);
  const labelIndexes = new Set(
    weeks.length <= 6 ? weeks.map((_, index) => index) : [0, Math.floor((weeks.length - 1) / 2), weeks.length - 1],
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="weekly-columns"
      role="img"
      aria-label={`Tracked leads by first-seen week across ${weeks.length} weeks, stacked by problem area: ${grand} leads in total, peak week ${peak}. Counts only still-tracked leads.`}
    >
      <line x1="0" y1={padT + plotH} x2={width} y2={padT + plotH} stroke="rgba(236,227,208,0.28)" strokeWidth="1" />
      <text x={0} y={10} fontFamily="var(--font-mono)" fontSize="10" fill="var(--dispatch-quiet)">
        {peak}
      </text>
      {weeks.map((week, index) => {
        const x = Math.round((width - weeks.length * pitch) / 2) + index * pitch + Math.round((pitch - colW) / 2);
        // Pure scan: each segment's offset is the sum of heights below it.
        const heights = categories.map(({ category }) => {
          const value = week.counts[category] ?? 0;
          return value > 0 ? Math.max(2, Math.round(value * unit)) : 0;
        });
        const offsets = heights.map((_, i) => heights.slice(0, i).reduce((sum, h) => sum + (h > 0 ? h + 2 : 0), 0));
        return (
          <g key={week.weekStart}>
            {categories.map((cat, i) => {
              const value = week.counts[cat.category] ?? 0;
              if (value <= 0) return null;
              const y = padT + plotH - offsets[i] - heights[i];
              return (
                <rect key={cat.category} x={x} y={y} width={colW} height={heights[i]} fill={cat.color}>
                  <title>{`Week of ${shortDate(week.weekStart)}: ${value} ${cat.label.toLowerCase()} lead${value === 1 ? "" : "s"}`}</title>
                </rect>
              );
            })}
            {labelIndexes.has(index) ? (
              <text
                x={x + colW / 2}
                y={height - 5}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                fill="var(--dispatch-quiet)"
              >
                {shortDate(week.weekStart)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

const HEAT_BINS = 4;

/**
 * Season heat strip: one cell per day, intensity = that register's activity.
 * Evidence wears the crimson ramp, radar the blue ramp — a sequential ramp is
 * one hue light-to-dark, so the two registers stay unmistakably separate.
 */
export function HeatStrip({
  days,
  tone,
  label,
  ariaLabel,
}: {
  days: { day: string; value: number; detail: string }[];
  tone: "evidence" | "radar";
  label: string;
  ariaLabel: string;
}) {
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.value));
  const bin = (value: number) => (value <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * HEAT_BINS)));
  return (
    <div className="heat-strip" role="img" aria-label={ariaLabel}>
      <span className="heat-strip__label">{label}</span>
      <div className="heat-strip__cells">
        {days.map((day) => (
          <span
            key={day.day}
            className={`heat-cell heat-cell--${tone}${bin(day.value)}`}
            title={`${shortDate(day.day)} · ${day.detail}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Category sparklines: one row per problem area — the line wears the category
 * hue, the label and numbers stay in ink (direct-labeled, so identity never
 * rides on color alone). Series share one y-scale for honest comparison.
 */
export function CategorySparklines({
  weeks,
  categories,
  width,
}: {
  weeks: RadarWeeklyPoint[];
  categories: ChartCategory[];
  width: number;
}) {
  if (weeks.length < 2 || categories.length === 0) return null;
  // 48px of drawable height (was 26): at 26px the entire series lived in a
  // 20px band and read as a flat dash on desktop monitors.
  const height = 48;
  const sharedMax = Math.max(
    1,
    ...weeks.flatMap((week) => categories.map(({ category }) => week.counts[category] ?? 0)),
  );
  const stepX = (width - 4) / (weeks.length - 1);
  return (
    <div className="cat-sparklines">
      {categories.map((cat) => {
        const values = weeks.map((week) => week.counts[cat.category] ?? 0);
        const total = values.reduce((sum, n) => sum + n, 0);
        if (total === 0) return null;
        const pointsAttr = values
          .map((value, index) => `${(2 + index * stepX).toFixed(1)},${(height - 3 - (value / sharedMax) * (height - 6)).toFixed(1)}`)
          .join(" ");
        return (
          <div key={cat.category} className="cat-sparklines__row">
            <span className="cat-sparklines__label">
              <i className="cat-swatch" style={{ background: cat.color }} aria-hidden="true" />
              {cat.label}
            </span>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${cat.label}: ${values.join(", ")} still-tracked leads first seen per week, oldest first.`}
            >
              <polyline points={pointsAttr} fill="none" stroke={cat.color} strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <span className="cat-sparklines__count num-quiet">{total}</span>
          </div>
        );
      })}
    </div>
  );
}
/**
 * Recurrence small multiples: the recurrence field split into one tinted
 * panel per problem area. All panels share both scales so panels compare
 * honestly; the panel label names the category, so the hue is redundant.
 * Solid dots are published leads, hollow dots private ones.
 */
export function RecurrenceSmallMultiples({
  points,
  categories,
}: {
  points: RadarRecurrencePoint[];
  categories: ChartCategory[];
}) {
  if (points.length === 0) return null;
  const maxDays = Math.max(1, ...points.map((p) => p.daysTracked));
  const maxSeen = Math.max(2, ...points.map((p) => p.seenCount));
  // Larger canvas + a labeled y-axis (was 168×96 with 8.5px type and no y
  // numbers): the panels also scale up to their grid cell via CSS width:100%.
  const w = 220;
  const h = 128;
  const padL = 26;
  const padB = 18;
  const plotW = w - padL - 8;
  const plotH = h - padB - 8;

  const panels = categories
    .map((cat) => ({ cat, pts: points.filter((p) => p.category === cat.category) }))
    .filter(({ pts }) => pts.length > 0);
  if (panels.length === 0) return null;

  return (
    <div className="recurrence-multiples" role="group" aria-label="Recurrence by problem area, shared scales across panels">
      {panels.map(({ cat, pts }) => {
        const grouped = new Map<string, { point: RadarRecurrencePoint; count: number }>();
        for (const point of pts) {
          const key = `${point.daysTracked}:${point.seenCount}:${point.isPublic}`;
          const existing = grouped.get(key);
          if (existing) existing.count += 1;
          else grouped.set(key, { point, count: 1 });
        }
        return (
          <figure key={cat.category} className="recurrence-panel">
            <figcaption className="recurrence-panel__head">
              <i className="cat-swatch" style={{ background: cat.color }} aria-hidden="true" />
              {cat.label}
              <span className="num-quiet">{pts.length}</span>
            </figcaption>
            <svg
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              role="img"
              aria-label={`${cat.label}: ${pts.length} leads by days tracked (0 to ${maxDays}) and times seen (1 to ${maxSeen}×).`}
            >
              <line x1={padL} y1={8 + plotH} x2={w - 4} y2={8 + plotH} stroke="rgba(236,227,208,0.2)" strokeWidth="1" />
              {[...grouped.values()].map(({ point, count }) => {
                // Left inset keeps the leftmost dot center 12px right of padL and
                // the bottom inset keeps the lowest (1×) dot center 14px above the
                // baseline, so enlarged dots never cross the axis or the y gutter.
                const x = padL + 12 + (point.daysTracked / maxDays) * (plotW - 20);
                const y = 8 + plotH - 14 - ((point.seenCount - 1) / (maxSeen - 1)) * (plotH - 26);
                const radius = Math.min(8, 3.25 * Math.sqrt(count));
                return (
                  <circle
                    key={`${point.daysTracked}:${point.seenCount}:${point.isPublic}`}
                    cx={x.toFixed(1)}
                    cy={y.toFixed(1)}
                    r={radius.toFixed(1)}
                    fill={point.isPublic ? cat.color : "none"}
                    stroke={cat.color}
                    strokeWidth={point.isPublic ? 0 : 1.8}
                    opacity={point.isPublic ? 1 : 0.9}
                  >
                    <title>{`${count === 1 ? "1 lead" : `${count} leads`} · seen ${point.seenCount}× · tracked ${point.daysTracked}d${point.isPublic ? " · published" : " · private"}`}</title>
                  </circle>
                );
              })}
              <text x={padL} y={h - 4} fontFamily="var(--font-mono)" fontSize="11" fill="var(--dispatch-quiet)">
                0D
              </text>
              <text x={w - 4} y={h - 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--dispatch-quiet)">
                {maxDays}D
              </text>
              <text x={padL - 5} y={14} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--dispatch-quiet)">
                {maxSeen}×
              </text>
              <text x={padL - 5} y={8 + plotH - 10} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--dispatch-quiet)">
                1×
              </text>
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
