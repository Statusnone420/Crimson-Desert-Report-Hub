import { formatEasternDateTime } from "@/lib/automation/runDisplay";
import { collectionHealth, type CollectionHealthInput, type CollectionHealthLane } from "@/lib/collectionHealth";

function stateClass(lane: CollectionHealthLane): string {
  return lane.state === "ok" ? "is-green" : lane.state === "disabled" ? "" : "is-amber";
}

function captureLine(lane: CollectionHealthLane): string {
  if (!lane.lastCaptureAt) return "Last capture unavailable";
  return `Last capture ${formatEasternDateTime(lane.lastCaptureAt)}`;
}

export function CollectionHealth(props: Omit<CollectionHealthInput, "now"> & { nowIso: string }) {
  const health = collectionHealth({ ...props, now: new Date(props.nowIso) });

  return (
    <section className="operator-records collection-health" id="collection-health" aria-label="Collection health">
      <div className="section-heading">
        <div>
          <p className="dispatch-kicker dispatch-kicker--amber">Provider records</p>
          <h2 className="section-heading__title">Collection health</h2>
        </div>
        <p className="section-heading__note">
          Steam reviews, Twitch audience, and IGDB platform metadata are checked separately. These are service records, not player evidence.
        </p>
      </div>
      <div className="lead-record-grid">
        {health.lanes.map((lane) => (
          <article className="op-rail-block" key={lane.key}>
            <p className="dispatch-kicker">{lane.label}</p>
            <p className={`op-rail__sentence ${stateClass(lane)}`}>{lane.labelText}</p>
            {lane.lastSuccessfulCaptureAt ? (
              <p className="op-rail__readout">Last successful known capture {formatEasternDateTime(lane.lastSuccessfulCaptureAt)}</p>
            ) : (
              <p className="op-rail__readout">{captureLine(lane)}</p>
            )}
            {lane.latestAttemptAt && lane.latestAttemptAt !== lane.lastSuccessfulCaptureAt ? (
              <p className="op-rail__readout">Latest attempt {formatEasternDateTime(lane.latestAttemptAt)}</p>
            ) : null}
            <p className="op-rail__readout">{lane.detail}</p>
            {lane.nextAction ? <p className="op-note">Next action: {lane.nextAction}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
