/**
 * Share of screened candidates that became a unique tracked lead.
 * This is a selectivity metric, not an accuracy or evidence score.
 */
export function radarYieldPct(tracked: number, reviewed: number): number {
  return reviewed > 0 ? (tracked / reviewed) * 100 : 0;
}
