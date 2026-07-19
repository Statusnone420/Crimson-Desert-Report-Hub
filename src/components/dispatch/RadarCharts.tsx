import type { ActivityDay } from "@/lib/activitySeries";
import type { RadarRecurrencePoint } from "@/lib/radar.server";

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

export type DonutSlice = { label: string; value: number; color: string };

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * Share-of-whole donut. Slice colors are the fixed per-category chart hues
 * (color follows the category, never its rank); the 2px slice gaps and the
 * labeled legend beside it are the required secondary encoding.
 */
export function InkDonut({
  slices,
  size,
  thickness,
  centerLabel,
}: {
  slices: DonutSlice[];
  size: number;
  thickness: number;
  centerLabel: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const inner = r - thickness;
  const gapRad = slices.length > 1 ? 0.03 : 0;

  // Pure angle scan (no reassignment during render): each slice's start is the
  // running sum of the sweeps before it.
  const sweeps = slices.map((slice) => (slice.value / total) * Math.PI * 2);
  const starts = sweeps.map((_, index) =>
    sweeps.slice(0, index).reduce((sum, sweep) => sum + sweep, -Math.PI / 2),
  );

  const paths = slices.map((slice, index) => {
    const sweep = sweeps[index];
    const start = starts[index] + gapRad / 2;
    const end = starts[index] + sweep - gapRad / 2;
    if (end <= start) return null;
    const largeArc = end - start > Math.PI ? 1 : 0;
    const p0 = polar(cx, cy, r, start);
    const p1 = polar(cx, cy, r, end);
    const p2 = polar(cx, cy, inner, end);
    const p3 = polar(cx, cy, inner, start);
    const d = [
      `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      "Z",
    ].join(" ");
    return (
      <path key={slice.label} d={d} fill={slice.color}>
        <title>{`${slice.label}: ${slice.value} of ${total}`}</title>
      </path>
    );
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${centerLabel}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(", ")}.`}
    >
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="26"
        fill="var(--dispatch-ink)"
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="9"
        letterSpacing="0.08em"
        fill="var(--dispatch-quiet)"
      >
        {centerLabel.toUpperCase()}
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

/**
 * Recurrence field: one dot per tracked lead — days tracked across, times
 * seen up. Carries no text, no URL, no title: position and visibility only.
 * Overlapping leads grow the dot (area ∝ count) instead of jittering.
 */
export function RecurrenceScatter({
  points,
  width,
  height,
}: {
  points: RadarRecurrencePoint[];
  width: number;
  height: number;
}) {
  if (points.length === 0) return null;
  const padL = 26;
  const padB = 20;
  const padT = 8;
  const plotW = width - padL - 8;
  const plotH = height - padB - padT;
  const maxDays = Math.max(1, ...points.map((p) => p.daysTracked));
  const maxSeen = Math.max(2, ...points.map((p) => p.seenCount));

  const grouped = new Map<string, { point: RadarRecurrencePoint; count: number }>();
  for (const point of points) {
    const key = `${point.daysTracked}:${point.seenCount}:${point.isPublic}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { point, count: 1 });
  }

  const recurring = points.filter((p) => p.seenCount > 1).length;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="recurrence-chart"
      role="img"
      aria-label={`Recurrence field: ${points.length} tracked leads plotted by days tracked and times seen. ${recurring} have been seen more than once. Public leads are marked in blue.`}
    >
      <line
        x1={padL}
        y1={padT + plotH}
        x2={width - 4}
        y2={padT + plotH}
        stroke="rgba(236,227,208,0.28)"
        strokeWidth="1"
      />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="rgba(236,227,208,0.14)" strokeWidth="1" />
      <text
        x={padL - 6}
        y={padT + 8}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="9.5"
        fill="var(--dispatch-quiet)"
      >
        {maxSeen}×
      </text>
      <text
        x={padL - 6}
        y={padT + plotH}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="9.5"
        fill="var(--dispatch-quiet)"
      >
        1×
      </text>
      <text
        x={width - 4}
        y={height - 4}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="9.5"
        fill="var(--dispatch-quiet)"
      >
        {maxDays}D TRACKED
      </text>
      <text x={padL} y={height - 4} fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--dispatch-quiet)">
        0D
      </text>
      {[...grouped.values()].map(({ point, count }) => {
        const x = padL + (point.daysTracked / maxDays) * (plotW - 8) + 4;
        const y = padT + plotH - ((point.seenCount - 1) / (maxSeen - 1)) * (plotH - 8) - 4;
        const radius = Math.min(9, 3 * Math.sqrt(count));
        return (
          <circle
            key={`${point.daysTracked}:${point.seenCount}:${point.isPublic}`}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={radius.toFixed(1)}
            fill={point.isPublic ? "var(--blue)" : "rgba(236,227,208,0.32)"}
          >
            <title>{`${count === 1 ? "1 lead" : `${count} leads`} · seen ${point.seenCount}× · tracked ${point.daysTracked}d${point.isPublic ? " · public" : ""}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
