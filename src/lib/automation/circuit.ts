// Single source of truth for the OpenRouter cost-safety circuit. The automation
// engine (run.ts) and every status display must call the same function over the
// same read window, so the badge can never disagree with what the scanner does.

export const COST_UNVERIFIED_TRIP_COUNT = 3;
export const COST_UNVERIFIED_TRIP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CircuitRunRow = {
  skips?: unknown;
  started_at?: string | null;
};

function monthStartMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function startedAtMs(row: CircuitRunRow): number {
  return typeof row.started_at === "string" ? new Date(row.started_at).getTime() : Number.NaN;
}

function hasSkip(row: CircuitRunRow, reason: string): boolean {
  return Array.isArray(row.skips) && row.skips.includes(reason);
}

/**
 * Earliest started_at a circuit evaluation needs. The blip window is rolling,
 * so during the first 24h of a month it reaches back into the previous month;
 * the rest of the month it equals the month start (which spend reads need anyway).
 */
export function circuitReadStartIso(now: Date): string {
  return new Date(Math.min(monthStartMs(now), now.getTime() - COST_UNVERIFIED_TRIP_WINDOW_MS)).toISOString();
}

/**
 * Circuit state from automation_runs rows read since circuitReadStartIso(now):
 * a money anomaly latches for the rest of the UTC month; cost-unverified runs
 * only trip when COST_UNVERIFIED_TRIP_COUNT of them land inside the rolling window.
 */
/**
 * Badge-side circuit evaluation over a raw history read. `null` means the read
 * failed, so the circuit state is unknown.
 *
 * The engine still fails closed on the same failure — it evaluates the circuit
 * itself before provider work (loadMonthSpend / startAutomationScan) and skips
 * the LLM lane. That is a decision about whether to spend. This function only
 * feeds a status display, and a display must not turn "the read failed" into
 * the claim that the cost circuit is open; it says unknown instead.
 */
export function llmPausedFromCircuitRead(
  rows: CircuitRunRow[] | null,
  error: unknown,
  now: Date,
): boolean | null {
  if (error) return null;
  return openRouterCircuitOpenFromRuns(rows ?? [], now);
}

export function openRouterCircuitOpenFromRuns(rows: CircuitRunRow[], now: Date): boolean {
  const monthStart = monthStartMs(now);
  const moneyAnomaly = rows.some(
    (row) =>
      startedAtMs(row) >= monthStart &&
      (hasSkip(row, "openrouter_unexpected_charge") || hasSkip(row, "openrouter_budget_exceeded")),
  );
  if (moneyAnomaly) return true;
  const windowStart = now.getTime() - COST_UNVERIFIED_TRIP_WINDOW_MS;
  const recentUnverified = rows.filter(
    (row) => hasSkip(row, "openrouter_cost_unverified") && startedAtMs(row) >= windowStart,
  ).length;
  return recentUnverified >= COST_UNVERIFIED_TRIP_COUNT;
}
