type ActivityPoint = { date: string; count: number };

function labelDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function PatchActivityChart({
  reports,
  signals,
}: {
  reports: ActivityPoint[];
  signals: ActivityPoint[];
}) {
  const days = reports.length >= signals.length ? reports : signals;
  if (days.length === 0) return null;

  const width = 860;
  const height = 190;
  const top = 18;
  const right = 12;
  const bottom = 34;
  const left = 28;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const reportCounts = reports.map((point) => point.count);
  const signalCounts = signals.map((point) => point.count);
  const max = Math.max(...reportCounts, ...signalCounts, 1);
  const group = chartWidth / days.length;
  const barWidth = Math.max(3, Math.min(10, group * 0.32));
  const ticks = [0, Math.ceil(max / 2), max].filter((tick, index, all) => all.indexOf(tick) === index);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--crimson)" }} />
          Approved reports
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--blue)" }} />
          Public signals
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Approved reports and public signals over the last 30 days">
        {ticks.map((tick) => {
          const y = top + chartHeight - (tick / max) * chartHeight;
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={0} y={y + 4} fill="var(--text-faint)" fontSize="10" className="num">
                {tick}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const x = left + index * group + group * 0.18;
          const report = reports[index]?.count ?? 0;
          const signal = signals[index]?.count ?? 0;
          const reportHeight = (report / max) * chartHeight;
          const signalHeight = (signal / max) * chartHeight;
          const showLabel = index === 0 || index === days.length - 1 || index % 7 === 0;
          return (
            <g key={day.date}>
              <rect
                x={x}
                y={top + chartHeight - reportHeight}
                width={barWidth}
                height={Math.max(report > 0 ? 2 : 0, reportHeight)}
                rx="2"
                fill="var(--crimson)"
              >
                <title>{`${labelDate(day.date)}: ${report} approved reports`}</title>
              </rect>
              <rect
                x={x + barWidth + 2}
                y={top + chartHeight - signalHeight}
                width={barWidth}
                height={Math.max(signal > 0 ? 2 : 0, signalHeight)}
                rx="2"
                fill="var(--blue)"
              >
                <title>{`${labelDate(day.date)}: ${signal} public signals`}</title>
              </rect>
              {showLabel ? (
                <text x={x} y={height - 10} fill="var(--text-faint)" fontSize="10">
                  {labelDate(day.date)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
