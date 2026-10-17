// Single source of truth for the OpenRouter cost-safety circuit. The automation
// engine (run.ts) and every status display must call the same function over the
// same read window, so the badge can never disagree with what the scanner does.
//
// Only a money anomaly opens it. An unverified cost stops AI for the rest of
// that run; it never pauses later runs.

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

/** Earliest started_at a circuit evaluation needs: the UTC month start. */
export function circuitReadStartIso(now: Date): string {
  return new Date(monthStartMs(now)).toISOString();
}

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

/** A money anomaly in the current UTC month latches the circuit for that month. */
export function openRouterCircuitOpenFromRuns(rows: CircuitRunRow[], now: Date): boolean {
  const monthStart = monthStartMs(now);
  return rows.some(
    (row) =>
      startedAtMs(row) >= monthStart &&
      (hasSkip(row, "openrouter_unexpected_charge") || hasSkip(row, "openrouter_budget_exceeded")),
  );
}
