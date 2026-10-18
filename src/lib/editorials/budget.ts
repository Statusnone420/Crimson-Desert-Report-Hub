/** The column's spending limits. They are separate from the scanner's and never read its settings. */
export const DEFAULT_COLUMN_MONTHLY_USD = 15;
export const MAX_COLUMN_MONTHLY_USD = 50;
export const DEFAULT_COLUMN_REQUEST_USD = 1;

function envNumber(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** The operator's monthly cap if set, else COLUMN_BUDGET_USD_MONTHLY, else $15. Never above $50. */
export function columnMonthlyCapUsd(settingsCap: number | null, env: NodeJS.ProcessEnv = process.env): number {
  const cap = settingsCap ?? envNumber(env.COLUMN_BUDGET_USD_MONTHLY) ?? DEFAULT_COLUMN_MONTHLY_USD;
  return Math.min(cap, MAX_COLUMN_MONTHLY_USD);
}

/** COLUMN_REQUEST_CAP_USD, else $1. Never above the $50 monthly ceiling. */
export function columnRequestCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  return Math.min(envNumber(env.COLUMN_REQUEST_CAP_USD) ?? DEFAULT_COLUMN_REQUEST_USD, MAX_COLUMN_MONTHLY_USD);
}

/** The ledger's month key, in UTC. */
export function ledgerMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}
