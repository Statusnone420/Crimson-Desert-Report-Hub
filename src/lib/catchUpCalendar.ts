export function localCalendarDay(date: Date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function catchUpLocalMidnight(day: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const midnight = new Date(`${day}T00:00:00`);
  if (!Number.isFinite(midnight.getTime()) || localCalendarDay(midnight) !== day || midnight.getTime() > now.getTime()) return null;
  return midnight.toISOString();
}
