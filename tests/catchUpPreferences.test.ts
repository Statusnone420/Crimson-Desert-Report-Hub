import { describe, expect, it, vi } from "vitest";
import { CATCH_UP_STORAGE_KEY, parseCatchUpPreferences, readCatchUpPreferences, writeCatchUpPreferences } from "@/lib/catchUpPreferences";

const now = new Date("2026-09-06T12:00:00.000Z");
const past = "2026-09-05T12:00:00.000Z";
const defaults = { remember: true, lastVisit: null, caughtUpThrough: null };
const record = { remember: true, lastVisit: past, caughtUpThrough: now.toISOString() };

describe("catch-up preferences", () => {
  it.each([null, "{", "null", "[]", "true", '"text"', "42", "{}", '{"remember":"false"}', '{"remember":0}'])("defaults safely for malformed or absent data: %s", (raw) => {
    expect(parseCatchUpPreferences(raw, now)).toEqual(defaults);
  });

  it("retains valid timestamps, including the exact current time", () => {
    expect(parseCatchUpPreferences(JSON.stringify(record), now)).toEqual(record);
  });

  it.each(["2026-09-07T00:00:00Z", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-09-05T24:00:00Z", "2026-09-05", "09/05/2026", "invalid", 0, true, {}, []])("rejects invalid timestamps independently: %j", (invalid) => {
    expect(parseCatchUpPreferences(JSON.stringify({ ...record, lastVisit: invalid }), now)).toEqual({ ...record, lastVisit: null });
    expect(parseCatchUpPreferences(JSON.stringify({ ...record, caughtUpThrough: invalid }), now)).toEqual({ ...record, caughtUpThrough: null });
  });

  it("compares ISO offsets as instants", () => {
    const lastVisit = "2026-09-06T08:00:00-04:00";
    expect(parseCatchUpPreferences(JSON.stringify({ ...record, lastVisit }), now).lastVisit).toBe(lastVisit);
    expect(parseCatchUpPreferences(JSON.stringify({ ...record, lastVisit: "2026-09-06T09:00:00-04:00" }), now).lastVisit).toBeNull();
  });

  it("ignores malicious extra fields and does not copy prototypes", () => {
    expect(parseCatchUpPreferences('{"remember":true,"__proto__":{"polluted":true},"extra":"private"}', now)).toEqual(defaults);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("clears timestamps when remembering is disabled", () => {
    expect(parseCatchUpPreferences(JSON.stringify({ ...record, remember: false }), now)).toEqual({ ...defaults, remember: false });
  });

  it("reads only the designated device key and distinguishes malformed data from unavailable storage", () => {
    const getItem = vi.fn(() => "{");
    expect(readCatchUpPreferences({ getItem }, now)).toEqual({ preferences: defaults, available: true });
    expect(getItem).toHaveBeenCalledWith(CATCH_UP_STORAGE_KEY);
    expect(readCatchUpPreferences({ getItem: () => { throw new Error("blocked"); } }, now)).toEqual({ preferences: defaults, available: false });
  });

  it("writes only allowed fields and persists opt-out without timestamps", () => {
    const setItem = vi.fn();
    expect(writeCatchUpPreferences({ setItem }, { ...record, extra: "private" } as typeof record)).toBe(true);
    expect(setItem).toHaveBeenLastCalledWith(CATCH_UP_STORAGE_KEY, JSON.stringify(record));
    expect(writeCatchUpPreferences({ setItem }, { ...record, remember: false })).toBe(true);
    expect(setItem).toHaveBeenLastCalledWith(CATCH_UP_STORAGE_KEY, JSON.stringify({ ...defaults, remember: false }));
  });

  it("reports failed writes", () => {
    expect(writeCatchUpPreferences({ setItem: () => { throw new Error("quota"); } }, record)).toBe(false);
  });
});
