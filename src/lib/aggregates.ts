export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function buildDailySeries(
  rows: { created_at: string }[],
  days: number,
  today: Date,
): { date: string; count: number }[] {
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const counts = countBy(rows, (row) => dayKey(new Date(row.created_at)));
  const series: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(date);
    series.push({ date: key, count: counts[key] ?? 0 });
  }
  return series;
}

export function rankClusters<C extends { id: string }>(
  clusters: C[],
  reports: { cluster_id: string | null }[],
): (C & { count: number })[] {
  const counts = countBy(reports, (report) => report.cluster_id);
  return clusters.map((cluster) => ({ ...cluster, count: counts[cluster.id] ?? 0 })).sort((a, b) => b.count - a.count);
}
