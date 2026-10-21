import { describe, expect, it } from "vitest";
import { CATCH_UP_MILESTONES, type CatchUpMilestone } from "@/lib/catchUpContent";
import {
  countdownWords,
  currentLaunch,
  EXPANSION,
  expansionNotices,
  expansionRelease,
  expansionVideos,
  launchState,
  NOT_SAID_YET,
  utcDaysBetween,
} from "@/lib/expansion";

const AT = "2026-10-29T22:00:00Z";
const time = (iso: string) => Date.parse(iso);

function notice(overrides: Partial<CatchUpMilestone>): CatchUpMilestone {
  return {
    id: "notice",
    publishedAt: "2026-10-01T00:00:00Z",
    kind: "announcement",
    title: "A notice",
    summary: "A summary.",
    highlights: ["A highlight."],
    source: { label: "Pearl Abyss · notice", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=1" },
    ...overrides,
  };
}

describe("expansion countdown in UTC days", () => {
  it.each([
    ["2026-10-21T00:00:00Z", 8],
    ["2026-10-21T23:59:59Z", 8],
    ["2026-10-22T00:00:00Z", 7],
    ["2026-10-28T23:59:59Z", 1],
    ["2026-10-29T00:00:00Z", 0],
    ["2026-10-29T21:59:59Z", 0],
  ])("counts %s as %i days before the Oct 29 release", (now, days) => {
    expect(utcDaysBetween(time(now), time(AT))).toBe(days);
    expect(launchState(AT, time(now))).toEqual({ phase: "countdown", at: AT, days });
  });

  it("says the count in words", () => {
    expect(countdownWords(8)).toBe("in 8 days");
    expect(countdownWords(2)).toBe("in 2 days");
    expect(countdownWords(1)).toBe("tomorrow");
    expect(countdownWords(0)).toBe("today");
  });

  it("counts UTC calendar dates, not 24-hour periods", () => {
    // 45 hours before the release is still "tomorrow" by the date printed beside it.
    expect(utcDaysBetween(time("2026-10-28T01:00:00Z"), time(AT))).toBe(1);
    // An hour before a release just after midnight UTC is "tomorrow" too.
    expect(utcDaysBetween(time("2026-10-28T23:30:00Z"), time("2026-10-29T00:30:00Z"))).toBe(1);
  });
});

describe("launch phases", () => {
  it("switches from the countdown to the launch watch at the release instant", () => {
    expect(launchState(AT, time(AT) - 1)?.phase).toBe("countdown");
    expect(launchState(AT, time(AT))).toEqual({ phase: "watch", at: AT });
  });

  it("runs the launch watch for seven days, then says only that it is out", () => {
    expect(launchState(AT, time("2026-11-05T21:59:59Z"))?.phase).toBe("watch");
    expect(launchState(AT, time("2026-11-05T22:00:00Z"))).toEqual({ phase: "out", at: AT });
  });

  it("has no state without a readable release time or clock", () => {
    expect(launchState("not a date", time(AT))).toBeNull();
    expect(launchState(AT, Number.NaN)).toBeNull();
  });
});

describe("the release time from the timeline", () => {
  it("takes the newest notice that sets the date, as the Hub had it at the time", () => {
    const milestones = [
      notice({ id: "first", publishedAt: "2026-09-03T14:00:00Z", release: { id: EXPANSION.id, at: "2026-10-15T22:00:00Z" } }),
      notice({ id: "moved", publishedAt: "2026-09-30T10:20:00Z", release: { id: EXPANSION.id, at: AT } }),
      notice({ id: "other", publishedAt: "2026-10-05T00:00:00Z", release: { id: "another-release", at: "2027-01-01T00:00:00Z" } }),
    ];
    expect(currentLaunch(time("2026-09-20T00:00:00Z"), milestones)).toEqual({ phase: "countdown", at: "2026-10-15T22:00:00Z", days: 25 });
    expect(currentLaunch(time("2026-10-21T12:00:00Z"), milestones)).toEqual({ phase: "countdown", at: AT, days: 8 });
    expect(currentLaunch(time("2026-09-01T00:00:00Z"), milestones)).toBeNull();
  });

  it("reads Oct 29, 22:00 UTC from the stored timeline today", () => {
    const notices = expansionNotices(time("2026-10-21T12:00:00Z"));
    const release = expansionRelease(notices);
    expect(release?.at).toBe(AT);
    expect(release?.notice.source.url).toBe("https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=137");
    expect(notices.map((item) => item.id)).toEqual([
      "charting-the-unknown-features",
      "charting-the-unknown-diving-short",
      "announcement-charting-the-unknown-delay",
      "charting-the-unknown-announcement",
    ]);
  });

  it("lists each official video once, newest notice first", () => {
    const videos = expansionVideos(expansionNotices(time("2026-10-21T12:00:00Z")));
    expect(videos.map((video) => video.url)).toEqual([
      "https://www.youtube.com/watch?v=k9WnZqkAFis",
      "https://www.youtube.com/shorts/er6wiBEXYYs",
    ]);
    const twice = [notice({ related: [{ label: "Clip", url: "https://youtu.be/k9WnZqkAFis" }] }), notice({ id: "again", related: [{ label: "Same clip", url: "https://www.youtube.com/watch?v=k9WnZqkAFis" }] })];
    expect(expansionVideos(twice)).toHaveLength(1);
  });

  it("re-checks what is not said yet whenever a newer expansion notice joins the timeline", () => {
    const newest = expansionNotices(Number.POSITIVE_INFINITY, CATCH_UP_MILESTONES)[0];
    // Add the notice, read it, then move checkedAt to the day you checked the list against it.
    expect(NOT_SAID_YET.checkedAt >= newest.publishedAt.slice(0, 10), `${newest.id} is newer than the not-said-yet check`).toBe(true);
  });
});
