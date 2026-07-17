import { CATEGORY_LABELS } from "@/lib/constants";
import type { ObservatoryPatch } from "@/lib/telemetry.server";

function labelDate(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function daysBetween(earlier: string | null, later: string | null): number | null {
  if (!earlier || !later) return null;
  const days = Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

function categoryLabel(category: string | null): string {
  if (!category) return "General";
  return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;
}

/**
 * Every patch the hub has covered, oldest first: cadence, claimed-fix volume,
 * and what players actually confirmed. This strip is cross-patch on purpose —
 * it is the one part of the brief that grows instead of resetting.
 */
export function PatchTimeline({ patches }: { patches: ObservatoryPatch[] }) {
  if (patches.length === 0) {
    return <p className="chart-empty chart-empty--short">The timeline starts with the first tracked patch.</p>;
  }
  const maxClaims = Math.max(...patches.map((patch) => patch.claimedFixes), 1);

  return (
    <div className="patch-timeline">
      {patches.map((patch, index) => {
        const gap = index > 0 ? daysBetween(patches[index - 1].publishedAt, patch.publishedAt) : null;
        return (
          <div key={patch.version} className="patch-timeline__row">
            <div className="patch-timeline__id">
              <span className="patch-timeline__version num">{patch.version}</span>
              <span className="patch-timeline__date">
                {labelDate(patch.publishedAt)}
                {gap ? <span className="num"> · +{gap}d</span> : null}
              </span>
              {patch.isCurrent ? <span className="readout-mark readout-mark--crimson">Current</span> : null}
            </div>
            <div className="patch-timeline__claims">
              <div className="bar-list__label">
                <span>
                  <span className="num">{patch.claimedFixes}</span> claimed {patch.claimedFixes === 1 ? "fix" : "fixes"}
                </span>
                {patch.playerConfirmed > 0 ? (
                  <span className="num" style={{ color: "var(--green-bright)" }}>
                    {patch.playerConfirmed} player-confirmed
                  </span>
                ) : (
                  <span style={{ color: "var(--text-quiet)" }}>no player verdicts yet</span>
                )}
              </div>
              <div className="bar-list__track" aria-hidden="true">
                <span style={{ width: `${Math.round((patch.claimedFixes / maxClaims) * 100)}%` }} />
              </div>
              {patch.fixCategories.length > 0 ? (
                <p className="patch-timeline__categories">
                  {patch.fixCategories.map((entry, categoryIndex) => (
                    <span key={`${patch.version}-${entry.category ?? "general"}`}>
                      {categoryIndex > 0 ? " · " : ""}
                      {categoryLabel(entry.category)} <span className="num">{entry.count}</span>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="chart-accessible-data">
        <table>
          <caption>Patches covered by the hub with claimed fixes and player confirmations</caption>
          <thead>
            <tr>
              <th scope="col">Patch</th>
              <th scope="col">Published</th>
              <th scope="col">Claimed fixes</th>
              <th scope="col">Player-confirmed</th>
            </tr>
          </thead>
          <tbody>
            {patches.map((patch) => (
              <tr key={patch.version}>
                <th scope="row">{patch.version}</th>
                <td>{labelDate(patch.publishedAt)}</td>
                <td>{patch.claimedFixes}</td>
                <td>{patch.playerConfirmed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
