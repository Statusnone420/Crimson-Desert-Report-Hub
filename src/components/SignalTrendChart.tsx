type ActivityPoint = { date: string; count: number };

function labelDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function cumulative(points: ActivityPoint[]): ActivityPoint[] {
  let total = 0;
  return points.map((point) => {
    total += Math.max(0, point.count);
    return { ...point, count: total };
  });
}

function pathFor(points: ActivityPoint[], max: number, width: number, height: number, left: number, top: number) {
  if (points.length === 0) return "";
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((point, index) => {
      const x = left + index * step;
      const y = top + height - (point.count / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function SignalTrendChart({ reports, signals }: { reports: ActivityPoint[]; signals: ActivityPoint[] }) {
  const days = reports.length >= signals.length ? reports : signals;
  if (days.length === 0) return null;

  const reportSeries = cumulative(reports);
  const signalSeries = cumulative(signals);
  const width = 860;
  const height = 220;
  const top = 18;
  const right = 96;
  const bottom = 34;
  const left = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...reportSeries.map((point) => point.count), ...signalSeries.map((point) => point.count), 1);
  const step = days.length > 1 ? plotWidth / (days.length - 1) : plotWidth;
  const ticks = [0, Math.ceil(max / 2), max].filter((tick, index, all) => all.indexOf(tick) === index);
  const yFor = (value: number) => top + plotHeight - (value / max) * plotHeight;

  // Direct line-end labels beat a detached legend at this density. Nudge apart on collision.
  const reportEnd = reportSeries.length > 0 ? yFor(reportSeries[reportSeries.length - 1].count) : yFor(0);
  const signalEnd = signalSeries.length > 0 ? yFor(signalSeries[signalSeries.length - 1].count) : yFor(0);
  let reportLabelY = reportEnd;
  let signalLabelY = signalEnd;
  if (Math.abs(reportLabelY - signalLabelY) < 14) {
    if (reportLabelY <= signalLabelY) {
      reportLabelY -= (14 - Math.abs(reportEnd - signalEnd)) / 2;
      signalLabelY += (14 - Math.abs(reportEnd - signalEnd)) / 2;
    } else {
      reportLabelY += (14 - Math.abs(reportEnd - signalEnd)) / 2;
      signalLabelY -= (14 - Math.abs(reportEnd - signalEnd)) / 2;
    }
  }

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="trend-chart w-full"
        role="img"
        aria-label="Cumulative reports and source leads over the last 30 days"
      >
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
        <g className="trend-series" tabIndex={0} aria-label="Cumulative approved reports">
          <path
            className="trend-line"
            d={pathFor(reportSeries, max, plotWidth, plotHeight, left, top)}
            fill="none"
            stroke="var(--crimson)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {reportSeries.map((point, index) => (
            <circle
              key={`report-${point.date}`}
              className="trend-point"
              cx={left + index * step}
              cy={yFor(point.count)}
              r="2.75"
              fill="var(--crimson)"
            >
              <title>{`${labelDate(point.date)}: ${point.count} cumulative approved reports`}</title>
            </circle>
          ))}
        </g>
        <g className="trend-series" tabIndex={0} aria-label="Cumulative source leads">
          <path
            className="trend-line"
            d={pathFor(signalSeries, max, plotWidth, plotHeight, left, top)}
            fill="none"
            stroke="var(--blue)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {signalSeries.map((point, index) => (
            <circle
              key={`signal-${point.date}`}
              className="trend-point"
              cx={left + index * step}
              cy={yFor(point.count)}
              r="2.75"
              fill="var(--blue)"
            >
              <title>{`${labelDate(point.date)}: ${point.count} cumulative source leads`}</title>
            </circle>
          ))}
        </g>
        <text
          x={width - right + 10}
          y={reportLabelY + 3.5}
          fill="var(--crimson-bright)"
          fontSize="11"
          fontWeight="600"
        >
          Reports
        </text>
        <text x={width - right + 10} y={signalLabelY + 3.5} fill="var(--blue)" fontSize="11" fontWeight="600">
          Source leads
        </text>
        {days.map((day, index) => {
          const showLabel = index === 0 || index === days.length - 1 || index % 7 === 0;
          return showLabel ? (
            <text key={day.date} x={left + index * step} y={height - 10} fill="var(--text-faint)" fontSize="10" textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}>
              {labelDate(day.date)}
            </text>
          ) : null;
        })}
      </svg>
    </div>
  );
}
