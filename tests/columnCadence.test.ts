import { describe, expect, it } from "vitest";
import { activeBurst, dueSlots, isoWeek, nextSlot } from "@/lib/editorials/cadence";
import { meetsThreshold, relevanceScore } from "@/lib/editorials/relevance";
import { DEFAULT_COLUMN_SETTINGS, EXPANSION_LAUNCH_BURST, normalizeColumnSettings, type ColumnSettings } from "@/lib/editorials/settings";
import type { FactPackDeltas } from "@/lib/editorials/factPack";

const at = (iso: string) => new Date(iso);
const settings = (patch: Partial<ColumnSettings>): ColumnSettings => normalizeColumnSettings({ ...DEFAULT_COLUMN_SETTINGS, ...patch });
/** The oldest due slot, for the cases where at most one is due. */
const dueSlot = (value: ColumnSettings, now: Date) => dueSlots(value, now)[0] ?? null;

describe("slot keys", () => {
  it("uses ISO weeks, across a year boundary too", () => {
    expect(isoWeek("2026-10-26")).toBe("2026-W44");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2027-01-04")).toBe("2027-W01");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
  });

  it("schedules weekly, 2x and 3x slots on their days at the hour", () => {
    expect(dueSlot(settings({}), at("2026-10-26T14:00:00Z"))?.key).toBe("2026-W44:mon");
    const twice = settings({ mode: "2x", days: ["mon", "thu"] });
    expect(dueSlot(twice, at("2026-10-29T14:30:00Z"))?.key).toBe("2026-W44:thu");
    const thrice = settings({ mode: "3x", days: ["mon", "wed", "fri"] });
    expect(dueSlot(thrice, at("2026-10-28T15:00:00Z"))?.key).toBe("2026-W44:wed");
    expect(dueSlot(thrice, at("2026-10-30T19:59:00Z"))?.key).toBe("2026-W44:fri");
    expect(dueSlot(thrice, at("2026-10-27T14:00:00Z"))).toBeNull();
  });

  it("keeps written slots and new days apart when the days change mid-week", () => {
    const monday = dueSlot(settings({}), at("2026-10-26T14:00:00Z"))?.key;
    const thursday = dueSlot(settings({ days: ["thu"] }), at("2026-10-29T14:00:00Z"))?.key;
    expect([monday, thursday]).toEqual(["2026-W44:mon", "2026-W44:thu"]);
    // Adding an earlier day never renames Monday's slot, so it can't be written twice.
    expect(dueSlot(settings({ mode: "2x", days: ["sun", "mon"] }), at("2026-10-26T14:00:00Z"))?.key).toBe("2026-W44:mon");
  });

  it("is due from the slot time for six hours, then is gone for good", () => {
    const base = settings({});
    expect(dueSlot(base, at("2026-10-26T13:59:59Z"))).toBeNull();
    expect(dueSlot(base, at("2026-10-26T19:59:59Z"))?.key).toBe("2026-W44:mon");
    expect(dueSlot(base, at("2026-10-26T20:00:00Z"))).toBeNull();
    expect(dueSlot(base, at("2026-10-27T14:00:00Z"))).toBeNull();
  });

  it("keeps a late slot due past midnight UTC", () => {
    const late = settings({ hourUtc: 22 });
    expect(dueSlot(late, at("2026-10-27T01:00:00Z"))?.key).toBe("2026-W44:mon");
    expect(dueSlot(late, at("2026-10-27T04:00:00Z"))).toBeNull();
  });

  it("keeps both slots due, oldest first, when a late slot runs into the next day's early one", () => {
    const busy = settings({ hourUtc: 0, days: ["tue"], bursts: [{ ...EXPANSION_LAUNCH_BURST, id: "late-night", enabled: true, startDate: "2026-10-26", endDate: "2026-10-26", hourUtc: 23 }] });
    expect(dueSlots(busy, at("2026-10-27T00:30:00Z")).map((slot) => slot.key)).toEqual(["burst:late-night:2026-10-26", "2026-W44:tue"]);
    expect(dueSlots(busy, at("2026-10-27T05:30:00Z")).map((slot) => slot.key)).toEqual(["2026-W44:tue"]);
  });

  it("does nothing with the seeded expansion burst while it stays disabled", () => {
    expect(activeBurst(settings({}), "2026-10-30")).toBeNull();
    expect(dueSlot(settings({}), at("2026-10-30T14:00:00Z"))).toBeNull();
  });

  it("lets an enabled burst replace the base schedule with its own model, hold and relevance", () => {
    const burst = settings({ bursts: [{ ...EXPANSION_LAUNCH_BURST, enabled: true }] });
    const slot = dueSlot(burst, at("2026-10-30T15:00:00Z"));
    expect(slot).toMatchObject({ key: "burst:expansion-launch:2026-10-30", holdHours: 8, relevance: "always" });
    expect(slot?.burst?.model).toBe("claude-opus-5-5");
    // A Monday inside the burst is a burst day, not the weekly slot.
    expect(dueSlot(burst, at("2026-11-02T14:00:00Z"))?.key).toBe("burst:expansion-launch:2026-11-02");
    expect(dueSlot(burst, at("2026-11-05T14:00:00Z"))).toBeNull();
    expect(dueSlot(burst, at("2026-11-09T14:00:00Z"))?.key).toBe("2026-W46:mon");
  });

  it("names the next slot for the card", () => {
    expect(nextSlot(settings({}), at("2026-10-26T15:00:00Z"))?.key).toBe("2026-W45:mon");
    expect(nextSlot(settings({}), at("2026-10-26T13:00:00Z"))?.key).toBe("2026-W44:mon");
  });
});

const quiet: FactPackDeltas = { newPatchVersions: [], newUpdate: false, playersChangePct: null, reviewShareChangePoints: null, twitchChangePct: null, newPatternIssueIds: [] };

describe("relevance", () => {
  it("scores new notes, issues and movements", () => {
    expect(relevanceScore(quiet)).toBe(0);
    expect(relevanceScore({ ...quiet, newPatchVersions: ["2.04.00"], newUpdate: true })).toBe(3);
    expect(relevanceScore({ ...quiet, newPatchVersions: ["2.03.03"] })).toBe(2);
    expect(relevanceScore({ ...quiet, newPatternIssueIds: ["a", "b", "c", "d"] })).toBe(3);
    expect(relevanceScore({ ...quiet, playersChangePct: -9.9 })).toBe(0);
    expect(relevanceScore({ ...quiet, playersChangePct: -10 })).toBe(1);
    expect(relevanceScore({ ...quiet, playersChangePct: 25 })).toBe(2);
    expect(relevanceScore({ ...quiet, reviewShareChangePoints: -5 })).toBe(1);
    expect(relevanceScore({ ...quiet, twitchChangePct: 24.9 })).toBe(0);
    expect(relevanceScore({ ...quiet, twitchChangePct: -25 })).toBe(1);
  });

  it("applies each threshold", () => {
    expect(meetsThreshold(0, "always")).toBe(true);
    expect(meetsThreshold(1, "normal")).toBe(false);
    expect(meetsThreshold(2, "normal")).toBe(true);
    expect(meetsThreshold(3, "strict")).toBe(false);
    expect(meetsThreshold(4, "strict")).toBe(true);
  });
});
