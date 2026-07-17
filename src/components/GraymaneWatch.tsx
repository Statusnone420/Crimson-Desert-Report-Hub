import type { ObservatoryData } from "@/lib/telemetry.server";
import { radarYieldPct } from "@/lib/observatoryMetrics";

export function GraymaneWatch({ data }: { data: ObservatoryData }) {
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
