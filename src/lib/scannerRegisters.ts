/**
 * The scanner scoreboard's independently readable registers, named for the
 * numbers a reader sees rather than for the queries behind them:
 *
 * - `week` — reviewed, filtered, and kept over the last seven days
 * - `heartbeat` — when the scanner last checked
 * - `awaiting` — current-patch leads still short of corroboration
 * - `published` — issues carrying a full card on the board
 *
 * Kept out of `queries.ts` so display code can use these without importing a
 * `server-only` module.
 */
export const SCANNER_READ_REGISTERS = ["week", "heartbeat", "awaiting", "published"] as const;

export type ScannerReadRegister = (typeof SCANNER_READ_REGISTERS)[number];

/**
 * Did this register's read fail? A value behind a failed register is a
 * placeholder, and its cell has to say so rather than print it.
 */
export function registerUnread(readFailures: readonly ScannerReadRegister[], register: ScannerReadRegister): boolean {
  return readFailures.includes(register);
}

/**
 * Every register failed — a total outage rather than one broken query. Surfaces
 * that carry a whole-scoreboard message (an offline notice, a replaced band)
 * key off this, so a single failed read no longer triggers the full blackout.
 */
export function everyRegisterUnread(readFailures: readonly ScannerReadRegister[]): boolean {
  return SCANNER_READ_REGISTERS.every((register) => readFailures.includes(register));
}
