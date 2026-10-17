export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Spreadsheet applications execute cells that parse as formulas, so a string
 * whose first non-whitespace character is =, +, -, or @ — or whose first
 * character is a tab or carriage return — gets a literal apostrophe prefix
 * BEFORE structural quoting. Player-supplied report text then opens as text,
 * never as an attacker-controlled formula. Non-string values never trigger it.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[\t\r]/.test(value) || /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function buildCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const value = row[column];
          return csvEscape(typeof value === "string" ? neutralizeSpreadsheetFormula(value) : value);
        })
        .join(","),
    );
  }
  return lines.join("\r\n");
}
