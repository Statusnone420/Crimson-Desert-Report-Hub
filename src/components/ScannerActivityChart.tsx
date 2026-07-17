import type { ObservatoryDailyPoint } from "@/lib/telemetry.server";

function labelDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

/**
 * Daily scanner work, last 30 days. Total-vs-subset bars: the muted bar is
 * everything reviewed that day, the blue bar in front is what survived
 * screening — newly kept signals plus re-observations of tracked ones, so a
 * repeat-only day never reads as fully filtered. Counts, not cumulative —
 * sparse days should look sparse.
 */
export function ScannerActivityChart({ daily }: { daily: ObservatoryDailyPoint[] }) {
  if (daily.length === 0) return null;
  const survived = (point: ObservatoryDailyPoint) => point.kept + point.reobserved;

  const width = 860;
  const height = 240;
  const top = 18;
  const right = 96;
  const bottom = 34;
  const left = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...daily.map((point) => point.reviewed), 1);
  const step = plotWidth / daily.length;
  const barWidth = Math.max(4, step - 2);
  const yFor = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, Math.ceil(max / 2), max].filter((tick, index, all) => all.indexOf(tick) === index);
  const lastActive = [...daily].reverse().find((point) => point.reviewed > 0);

  return (
    <div className="scanner-activity-chart space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" aria-hidden="true">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={0} y={y + 4} fill="var(--text-dim)" fontSize="11" className="num">
                {tick}
              </text>
            </g>
          );
        })}
        {daily.map((point, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          const reviewedY = yFor(point.reviewed);
          const survivedY = yFor(survived(point));
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={reviewedY}
                width={barWidth}
                height={Math.max(0, top + plotHeight - reviewedY)}
                rx={2}
                fill="var(--text-quiet)"
                opacity={0.55}
              />
              {survived(point) > 0 ? (
                <rect
                  x={x}
                  y={survivedY}
                  width={barWidth}
                  height={Math.max(0, top + plotHeight - survivedY)}
                  rx={2}
                  fill="var(--blue)"
                />
              ) : null}
              <rect x={left + index * step} y={top} width={step} height={plotHeight} fill="transparent">
                <title>
                  {`${labelDate(point.date)}: ${point.reviewed} reviewed · ${point.kept} newly kept · ${point.reobserved} re-observed · ${point.llmCalls} model calls`}
                </title>
              </rect>
            </g>
          );
        })}
        {lastActive ? (
          <>
            <text
              x={width - right + 10}
              y={yFor(lastActive.reviewed) + 3.5}
              fill="var(--text-dim)"
              fontSize="11"
              fontWeight="600"
            >
              Reviewed
            </text>
            <text
              x={width - right + 10}
              y={Math.max(yFor(survived(lastActive)) + 3.5, yFor(lastActive.reviewed) + 17.5)}
              fill="var(--blue)"
              fontSize="11"
              fontWeight="600"
            >
              Survived
            </text>
          </>
        ) : null}
        {daily.map((point, index) => {
          const showLabel = index === 0 || index === daily.length - 1 || index % 7 === 0;
          return showLabel ? (
            <text
              key={point.date}
              x={left + index * step + step / 2}
              y={height - 10}
              fill="var(--text-faint)"
              fontSize="10"
              textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"}
            >
              {labelDate(point.date)}
            </text>
          ) : null;
        })}
      </svg>
      <div className="chart-accessible-data">
        <table>
          <caption>Daily scanner activity over the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Sources reviewed</th>
              <th scope="col">Newly kept</th>
              <th scope="col">Re-observed</th>
              <th scope="col">Model calls</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((point) => (
              <tr key={point.date}>
                <th scope="row">{labelDate(point.date)}</th>
                <td>{point.reviewed}</td>
                <td>{point.kept}</td>
                <td>{point.reobserved}</td>
                <td>{point.llmCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
