import type { ObservatoryData } from "@/lib/telemetry.server";
import { radarYieldPct } from "@/lib/telemetry.server";

function sinceDate(iso: string | null): string {
  if (!iso) return "no scans recorded";
  return `since ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  )}`;
}

function TileSparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2 || points.every((point) => point === 0)) return null;
  const width = 120;
  const height = 26;
  const max = Math.max(...points, 1);
  const stepX = width / (points.length - 1);
  const path = points
    .map((point, index) => {
      const x = (index * stepX).toFixed(1);
      const y = (height - (point / max) * (height - 4) - 2).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="telemetry-tile__spark" role="img" aria-label={label}>
      <path d={path} fill="none" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GraymaneWatch({ data }: { data: ObservatoryData }) {
  const { totals } = data;
  const yieldText = `${radarYieldPct(totals.tracked, totals.reviewed).toFixed(1)}%`;

  return (
    <details className="telemetry-watch">
      <summary aria-label="How Graymane’s Watch is calculated">
        <span aria-hidden="true">i</span>
        <span className="sr-only">How Graymane’s Watch is calculated</span>
      </summary>
      <div className="telemetry-watch__popover">
        <div className="eyebrow">Graymane’s Watch</div>
        <p>Radar yield is the share of screened candidates that became a unique tracked lead.</p>
        <p className="telemetry-watch__formula num">
          {totals.tracked.toLocaleString("en-US")} ÷ {totals.reviewed.toLocaleString("en-US")} = {yieldText}
        </p>
        <div className="telemetry-watch__stats">
          <div>
            <span>Repeat sightings</span>
            <span className="num">{totals.reobservations.toLocaleString("en-US")}</span>
          </div>
          <div>
            <span>Filtered overall</span>
            <span className="num">{totals.filtered.toLocaleString("en-US")}</span>
          </div>
          <div>
            <span>Scanner spend</span>
            <span className="num">${totals.costUsd.toFixed(2)}</span>
          </div>
          <div>
            <span>Model calls</span>
            <span className="num">{totals.llmCalls.toLocaleString("en-US")}</span>
          </div>
        </div>
        <p className="muted-note">
          Filtered is a screening result, not a player verdict. Trusted patch context can move to the observation lane;
          issue leads stay separate until corroborated.
        </p>
      </div>
    </details>
  );
}

/**
 * All-time scanner telemetry. These numbers are about the system's own work —
 * they accumulate across patches and never reset to zero on patch day.
 */
export function TelemetryBand({ data }: { data: ObservatoryData }) {
  const { totals } = data;
  const reviewedPerDay = data.daily.map((point) => point.reviewed);
  const tiles: { label: string; value: string; note: string; spark?: React.ReactNode; watch?: React.ReactNode }[] = [
    {
      label: "Sources reviewed",
      value: totals.reviewed.toLocaleString("en-US"),
      note: `${sinceDate(totals.firstRunAt)} · ${totals.scansPerDay} ${totals.scansPerDay === 1 ? "scan" : "scans"} a day`,
      spark: <TileSparkline points={reviewedPerDay} label="Sources reviewed per day, last 30 days" />,
    },
    {
      label: "Filtered out",
      value: totals.filtered.toLocaleString("en-US"),
      note: `${totals.filterRatePct}% of intake screened away`,
    },
    {
      label: "Signals tracked",
      value: totals.tracked.toLocaleString("en-US"),
      note:
        totals.reobservations > 0
          ? `re-observed ${totals.reobservations.toLocaleString("en-US")}× in the wild`
          : "no repeat sightings yet",
    },
    {
      label: "Model calls",
      value: totals.llmCalls.toLocaleString("en-US"),
      note: "completed scans + rescues; test runs excluded",
    },
    {
      label: "Radar yield",
      value: `${radarYieldPct(totals.tracked, totals.reviewed).toFixed(1)}%`,
      note: `${totals.tracked.toLocaleString("en-US")} leads held · ${totals.reobservations.toLocaleString("en-US")} repeat sightings`,
      watch: <GraymaneWatch data={data} />,
    },
    {
      label: "Patches covered",
      value: data.patches.length.toLocaleString("en-US"),
      note:
        data.patches.length > 1
          ? `${data.patches[0].version} → ${data.patches[data.patches.length - 1].version}`
          : data.patches.length === 1
            ? data.patches[0].version
            : "awaiting first patch",
    },
  ];

  return (
    <div className="telemetry-band">
      <div className="telemetry-band__scope">
        <span className="eyebrow">The observatory</span>
        <span>All patches · aggregate scanner record</span>
      </div>
      <div className="telemetry-band__tiles" role="list" aria-label="Scanner telemetry, all patches">
        {tiles.map((tile) => (
          <div key={tile.label} className="telemetry-tile" role="listitem">
            <div className="telemetry-tile__label">
              <span className="stat-label">{tile.label}</span>
              {tile.watch ?? null}
            </div>
            <span className="telemetry-tile__value num">{tile.value}</span>
            <span className="telemetry-tile__note">{tile.note}</span>
            {tile.spark ?? null}
          </div>
        ))}
      </div>
    </div>
  );
}
