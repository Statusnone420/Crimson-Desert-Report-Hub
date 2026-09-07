export const CATCH_UP_STORAGE_KEY = "crimson-catch-up-v1";

export type CatchUpPreferences = {
  remember: boolean;
  lastVisit: string | null;
  caughtUpThrough: string | null;
};

function defaults(): CatchUpPreferences {
  return { remember: true, lastVisit: null, caughtUpThrough: null };
}

function timestamp(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
    return null;
  }
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const time = Date.parse(value);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return Number.isFinite(time) && time <= now.getTime() ? value : null;
}

export function parseCatchUpPreferences(raw: string | null, now: Date = new Date()): CatchUpPreferences {
  if (raw === null) return defaults();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults();
    const record = value as Record<string, unknown>;
    if (typeof record.remember !== "boolean") return defaults();
    return {
      remember: record.remember,
      lastVisit: record.remember ? timestamp(record.lastVisit, now) : null,
      caughtUpThrough: record.remember ? timestamp(record.caughtUpThrough, now) : null,
    };
  } catch {
    return defaults();
  }
}

export function readCatchUpPreferences(
  storage: Pick<Storage, "getItem">,
  now?: Date,
): { preferences: CatchUpPreferences; available: boolean } {
  try {
    return { preferences: parseCatchUpPreferences(storage.getItem(CATCH_UP_STORAGE_KEY), now), available: true };
  } catch {
    return { preferences: defaults(), available: false };
  }
}

export function writeCatchUpPreferences(storage: Pick<Storage, "setItem">, value: CatchUpPreferences): boolean {
  try {
    storage.setItem(CATCH_UP_STORAGE_KEY, JSON.stringify({
      remember: value.remember,
      lastVisit: value.remember ? value.lastVisit : null,
      caughtUpThrough: value.remember ? value.caughtUpThrough : null,
    }));
    return true;
  } catch {
    return false;
  }
}
