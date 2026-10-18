import type { ReactNode } from "react";
import { CHART_WIDTH, monthTicks, PANEL_HEIGHT, type AxisTick, type PatchMarker } from "@/lib/activityCharts";

export type ChartPatch = { version: string; publishedAt: string | null; fixes: number };

export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Labels above the plot: each update carries its version and hotfixes are short
 * ticks. Narrow screens stagger the labels into two or three rows instead of
 * hiding any, and labels at the edges turn inward so they stay on the page.
 */
export function PatchLabels({ markers }: { markers: PatchMarker[] }) {
  return (
    <div className="dd-patch-strip" aria-hidden="true">
      {markers.map((marker) => (
        <span
          key={marker.version}
          className={marker.order === null ? "dd-patch-tick" : `dd-patch-tick is-update r2-${marker.order % 2} r3-${marker.order % 3}`}
          style={{ left: `${marker.x}%` }}
        >
          {marker.order === null ? null : (
            <span className={"dd-patch-label" + (marker.x < 6 ? " is-start" : marker.x > 94 ? " is-end" : "")}>{marker.version}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function MonthAxis({ days }: { days: { day: string }[] }) {
  return (
    <div className="dd-months" aria-hidden="true">
      {monthTicks(days).map((tick) => <span key={tick.label} style={{ left: `${tick.x}%` }}>{tick.label}</span>)}
    </div>
  );
}

/** A server-drawn plot with a y-axis, gridlines and a line at each update. */
export function Plot({ ticks, markers, children }: { ticks: AxisTick[]; markers: PatchMarker[]; children: ReactNode }) {
  return (
    <div className="dd-plot">
      <div className="dd-yaxis" aria-hidden="true">
        {ticks.map((tick) => <span key={tick.value} style={{ top: `${tick.top}%` }}>{tick.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${PANEL_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {ticks.map((tick) => (
          <line key={tick.value} className={tick === ticks[0] ? "dd-baseline" : "dd-gridline"} x1={0} x2={CHART_WIDTH}
            y1={(tick.top / 100) * PANEL_HEIGHT} y2={(tick.top / 100) * PANEL_HEIGHT} vectorEffect="non-scaling-stroke" />
        ))}
        {markers.filter((marker) => marker.update).map((marker) => (
          <line key={marker.version} className="dd-patch-line" x1={(marker.x / 100) * CHART_WIDTH} x2={(marker.x / 100) * CHART_WIDTH}
            y1={0} y2={PANEL_HEIGHT} vectorEffect="non-scaling-stroke" />
        ))}
        {children}
      </svg>
    </div>
  );
}
