import { describe, expect, it } from "vitest";
import { catchUpLocalMidnight, localCalendarDay } from "@/lib/catchUpCalendar";
import { catchUpHash, parseCatchUpHash } from "@/lib/catchUp";

describe("catch-up local calendar", () => {
  const now = new Date(2026, 8, 7, 1, 15);

  it("accepts local today and preserves that day when reopening the ISO selection", () => {
    expect(localCalendarDay(now)).toBe("2026-09-07");
    const since = catchUpLocalMidnight("2026-09-07", now)!;
    expect(new Date(since).getHours()).toBe(0);
    expect(localCalendarDay(new Date(since))).toBe("2026-09-07");
    expect(parseCatchUpHash(catchUpHash({ kind: "since", value: since }), now)).toEqual({ kind: "since", value: since });
  });

  it.each(["", "2026-02-30", "2026-13-01", "2026-09-08", "09/07/2026", "2026-9-7", "2026-09-07T00:00:00Z"])("rejects invalid or future calendar input: %s", (day) => {
    expect(catchUpLocalMidnight(day, now)).toBeNull();
  });

  it("preserves existing ISO instants without converting them to local midnight", () => {
    const since = "2026-09-05T12:34:56.789Z";
    expect(parseCatchUpHash(catchUpHash({ kind: "since", value: since }), now)).toEqual({ kind: "since", value: since });
  });
});
