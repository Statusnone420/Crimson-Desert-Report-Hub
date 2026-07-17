import { CATEGORY_LABELS } from "@/lib/constants";
import type { ObservatoryDomain } from "@/lib/telemetry.server";

const MAX_DOMAIN_ROWS = 8;

/**
 * Where candidates come from, and how ruthless the screen is per domain.
 * Two thin lanes per domain on one shared scale: kept (blue) vs filtered
 * (muted). reddit's 18-kept / 191-filtered split is the whole story.
 */
export function DomainLanes({ domains }: { domains: ObservatoryDomain[] }) {
  const rows = domains.slice(0, MAX_DOMAIN_ROWS);
  if (rows.length === 0) {
    return <p className="chart-empty chart-empty--short">Domain mix appears after the first scans.</p>;
  }
  const max = Math.max(...rows.map((row) => Math.max(row.kept, row.filtered)), 1);
  const overflow = domains.length - rows.length;

  return (
    <div className="mt-4 space-y-3.5">
      {rows.map((row) => (
        <div key={row.domain} className="min-w-0">
          <div className="bar-list__label">
            <span className="num">{row.domain}</span>
            <span className="num" style={{ color: "var(--text-faint)" }}>
              <span style={{ color: "var(--blue)" }}>{row.kept} kept</span> · {row.filtered} filtered
            </span>
          </div>
          <div className="duo-lane" aria-hidden="true">
            <span className="duo-lane__track">
              <span
                className="duo-lane__fill duo-lane__fill--kept"
                style={{ width: `${row.kept > 0 ? Math.max(2, Math.round((row.kept / max) * 100)) : 0}%` }}
              />
            </span>
            <span className="duo-lane__track">
              <span
                className="duo-lane__fill"
                style={{ width: `${row.filtered > 0 ? Math.max(2, Math.round((row.filtered / max) * 100)) : 0}%` }}
              />
            </span>
          </div>
        </div>
      ))}
      {overflow > 0 ? <p className="muted-note">+{overflow} more domains with smaller counts.</p> : null}
      <div className="chart-accessible-data">
        <table>
          <caption>
            Signals kept per source domain (all patches) and candidates filtered (rolling rescue window)
          </caption>
          <thead>
            <tr>
              <th scope="col">Domain</th>
              <th scope="col">Kept</th>
              <th scope="col">Filtered (recent)</th>
              <th scope="col">Times seen</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((row) => (
              <tr key={row.domain}>
                <th scope="row">{row.domain}</th>
                <td>{row.kept}</td>
                <td>{row.filtered}</td>
                <td>{row.totalSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What tracked signals are about — the scanner's read, distinct from player reports. */
export function CategorySplit({ categories }: { categories: Record<string, number> }) {
  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="chart-empty chart-empty--short">Category mix appears once signals are tracked.</p>;
  }
  const max = Math.max(...entries.map(([, count]) => count), 1);

  return (
    <div className="bar-list">
      {entries.map(([category, count]) => (
        <div key={category} className="bar-list__row">
          <div className="bar-list__label">
            <span>{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}</span>
            <span className="num">{count}</span>
          </div>
          <div className="bar-list__track" aria-hidden="true">
            <span style={{ width: `${Math.round((count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Extraction-confidence spread across tracked signals. */
export function ConfidenceMix({ mix }: { mix: { high: number; medium: number; low: number } }) {
  const total = mix.high + mix.medium + mix.low;
  if (total === 0) {
    return <p className="chart-empty chart-empty--short">Confidence spread appears once signals are tracked.</p>;
  }
  const rows: { key: string; label: string; count: number; fill: string }[] = [
    { key: "high", label: "High confidence", count: mix.high, fill: "var(--green)" },
    { key: "medium", label: "Medium confidence", count: mix.medium, fill: "var(--amber)" },
    { key: "low", label: "Low confidence", count: mix.low, fill: "var(--border-strong)" },
  ];

  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div key={row.key} className="bar-list__row">
          <div className="bar-list__label">
            <span>{row.label}</span>
            <span className="num">
              {row.count} <span style={{ color: "var(--text-quiet)" }}>· {Math.round((row.count / total) * 100)}%</span>
            </span>
          </div>
          <div className="bar-list__track" aria-hidden="true">
            <span style={{ width: `${Math.round((row.count / total) * 100)}%`, background: row.fill }} />
          </div>
        </div>
      ))}
    </div>
  );
}
