import type { OverviewHealthFact, OverviewScannerHealthModel } from "@/lib/operatorHealth";

function factClass(tone: OverviewHealthFact["tone"]): string {
  if (tone === "ok") return "";
  return ` is-${tone}`;
}

function FactList({
  title,
  facts,
}: {
  title: string;
  facts: OverviewHealthFact[];
}) {
  return (
    <div>
      <h3>{title}</h3>
      <dl className="workspace-health-facts">
        {facts.map((fact) => (
          <div key={fact.id} className={factClass(fact.tone).trim()}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              <small>{fact.detail}</small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function OverviewScannerHealth({ health }: { health: OverviewScannerHealthModel }) {
  return (
    <div className="workspace-overview-health-body">
      <div className="workspace-overview-health-status">
        <span className={`workspace-badge workspace-badge--${health.statusTone}`}>
          {health.statusLabel}
        </span>
        <p className="workspace-note">{health.headline}</p>
      </div>
      <div className="workspace-overview-health-grid">
        <FactList title="Schedule" facts={health.schedule} />
        <FactList title="Providers" facts={health.providers} />
        <FactList title="Core counters" facts={health.counters} />
      </div>
      {health.attention.items.length > 0 ? (
        <div className="workspace-queue" aria-label="Named scanner health checks">
          {health.attention.items.map((item) => (
            <article key={item.id} className="workspace-queue-item">
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </article>
          ))}
        </div>
      ) : null}
      <div className="workspace-overview-health-links">
        <a className="workspace-text-link" href={health.diagnosticsHref}>
          Open scanner diagnostics
        </a>
        <a className="workspace-text-link" href={health.collectionHref}>
          Collection records
        </a>
      </div>
    </div>
  );
}
