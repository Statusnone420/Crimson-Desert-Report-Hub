import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildActivityDays, type ActivityHistory } from "@/lib/activityHistory";
import type { BoardWatchRead } from "@/lib/boardWatch";

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(async (): Promise<unknown> => ({})),
  getPublicScannerData: vi.fn(async (): Promise<unknown> => ({ steamPulse: [], pulseReadFailures: [] })),
  getPatchRadarData: vi.fn(async (): Promise<unknown> => ({ connected: false })),
  getActivityHistory: vi.fn(async (): Promise<unknown> => ({})),
  getBoardWatchSummary: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/queries", () => ({ getDashboardData: mocks.getDashboardData, getPublicScannerData: mocks.getPublicScannerData }));
vi.mock("@/lib/radar.server", () => ({ getPatchRadarData: mocks.getPatchRadarData }));
vi.mock("@/lib/activityHistory.server", () => ({ getActivityHistory: mocks.getActivityHistory }));
vi.mock("@/lib/boardWatch.server", () => ({ getBoardWatchSummary: mocks.getBoardWatchSummary }));
vi.mock("@/lib/patchPublications.server", async () => {
  const { editorialArticles } = await import("@/lib/editorialArticles");
  return { getPatchPublications: vi.fn(async () => ({ articles: [...editorialArticles], editions: [], unavailable: false })) };
});

import HomePage from "@/app/page";

const DAY = 86_400_000;
const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

function dashboard(publishedAt: string) {
  return {
    topClusters: [],
    currentPatch: { version: "2.05.00", publishedAt, officialUrl: "https://example.com/notes", source: "official" },
    claimedFixes: [],
    claimsUnavailable: false,
    evidenceUnavailable: false,
    publicLeadsUnavailable: false,
    checkinsAvailable: true,
  };
}

// Invented launch-week records: the latest capture against four earlier Fridays, and review totals for three days.
function history(now: number, { reviewsToday = true } = {}): ActivityHistory {
  const captures = [4, 3, 2, 1].map((week) => ({ capturedAt: new Date(now - week * 7 * DAY).toISOString(), playerCount: 20_000 }));
  captures.push({ capturedAt: new Date(now - 10 * 60_000).toISOString(), playerCount: 30_000 });
  const reviews = [
    { day: "2026-10-28", totalReviews: 100_000, totalPositive: 80_000, positivePercentage: 80 },
    { day: "2026-10-29", totalReviews: 101_200, totalPositive: 80_800, positivePercentage: 80 },
    ...(reviewsToday ? [{ day: "2026-10-30", totalReviews: 101_600, totalPositive: 81_080, positivePercentage: 80 }] : []),
  ];
  return {
    checkedAt: new Date(now).toISOString(),
    days: buildActivityDays({ from: Date.parse("2026-10-28T00:00:00Z"), to: now, players: captures, twitch: [], reviews }),
    playerCaptures: captures,
    lanes: { players: "ready", twitch: "empty", reviews: "ready" },
  };
}

const watchSummary: BoardWatchRead = {
  patchVersion: "2.05.00",
  threads: 12,
  topics: 5,
  systems: [{ category: "crash_startup", threads: 6 }, { category: "performance", threads: 4 }, { category: "quest_progression", threads: 2 }],
};

async function frontPageAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  mocks.getActivityHistory.mockResolvedValue(history(Date.parse(iso)));
  return renderToStaticMarkup(await HomePage());
}

describe("the front page around the expansion launch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getDashboardData.mockResolvedValue(dashboard("2026-10-29T08:00:00Z"));
    mocks.getBoardWatchSummary.mockResolvedValue(watchSummary);
  });
  afterEach(() => vi.useRealTimers());

  it("shows one countdown line from the stored release time before launch", async () => {
    const markup = await frontPageAt("2026-10-21T12:00:00Z");
    const clock = markup.match(/<p class="launch-clock">[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(text(clock)).toBe("Charting the Unknown lands in 8 days, Oct 29, 22:00 UTC.");
    expect(clock).toContain('href="/topics/charting-the-unknown"');
    expect(markup).not.toContain("Launch watch");
    expect(text(markup)).toContain("The latest readings");
  });

  it("says today on release day, up to the release minute", async () => {
    const markup = await frontPageAt("2026-10-29T21:59:00Z");
    expect(text(markup.match(/<p class="launch-clock">[\s\S]*?<\/p>/)?.[0] ?? "")).toBe("Charting the Unknown lands today, Oct 29, 22:00 UTC.");
  });

  it("leads with the launch watch from the release instant, in place of the countdown and the usual readings", async () => {
    const markup = await frontPageAt("2026-10-30T15:00:00Z");
    expect(markup).not.toContain("launch-clock");
    expect(markup.match(/class="dd-brief"/g)).toHaveLength(1);
    expect(markup.indexOf('id="launch-watch"')).toBeGreaterThan(-1);
    expect(markup.indexOf('id="launch-watch"')).toBeLessThan(markup.indexOf('id="lead"'));
    const watch = text(markup.match(/<section class="dd-brief" id="launch-watch"[\s\S]*?<\/section>/)?.[0] ?? "");
    expect(watch).toContain("Charting the Unknown is out");
    expect(watch).toContain("Out since Oct 29, 22:00 UTC.");
    expect(watch).toContain("50% above the usual for a Friday at this time");
    expect(watch).toContain("Steam reviews, today so far400new Steam reviews, 70% positive.");
    expect(watch).toContain("Yesterday, a full day: 1,200 new, 67% positive.");
    expect(watch).toContain("2.05.00");
    expect(watch).not.toContain("No patch notes on the Hub since launch day yet.");
    expect(watch).toContain("The most threads: crashes and startup 6, performance 4, quests and progression 2.");
    expect(watch).toContain("Open the expansion desk");
    expect(watch).not.toContain("The latest readings");
  });

  it("names today by the page's clock when the records were read before UTC midnight", async () => {
    // Read at Oct 30, 23:45 and still cached when the page rebuilds at Oct 31, 00:10.
    vi.setSystemTime(new Date("2026-10-31T00:10:00Z"));
    mocks.getActivityHistory.mockResolvedValue(history(Date.parse("2026-10-30T23:45:00Z")));
    const watch = text(renderToStaticMarkup(await HomePage()).match(/<section class="dd-brief" id="launch-watch"[\s\S]*?<\/section>/)?.[0] ?? "");
    expect(watch).toContain("Steam reviews, today so farNo review record for today yet.");
    expect(watch).not.toContain("today so far400");
    expect(watch).not.toContain("Yesterday, a full day");
    // The Oct 29 patch is two days old by the page's clock.
    expect(watch).toContain("Oct 29 · 2 days ago");
  });

  it("says when no patch notes came since launch day", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboard("2026-10-22T09:00:00Z"));
    const markup = await frontPageAt("2026-10-30T15:00:00Z");
    expect(text(markup)).toContain("No patch notes on the Hub since launch day yet.");
  });

  it("shows unread or missing launch-week records as such, never as zero", async () => {
    vi.setSystemTime(new Date("2026-10-30T15:00:00Z"));
    mocks.getActivityHistory.mockResolvedValue({
      checkedAt: "2026-10-30T15:00:00.000Z", days: [], playerCaptures: [], lanes: { players: "unavailable", twitch: "unavailable", reviews: "unavailable" },
    });
    mocks.getBoardWatchSummary.mockResolvedValue("unavailable");
    const unread = text(renderToStaticMarkup(await HomePage()));
    expect(unread).toContain("Steam player counts could not be read.");
    expect(unread).toContain("Steam review totals could not be read.");
    expect(unread).toContain("The scanner's thread counts could not be read.");

    mocks.getActivityHistory.mockResolvedValue(history(Date.parse("2026-10-30T15:00:00Z"), { reviewsToday: false }));
    const missing = text(renderToStaticMarkup(await HomePage()));
    expect(missing).toContain("No review record for today yet.");
    expect(missing).not.toMatch(/today so far0/);
  });

  it("returns to the usual front page after launch week", async () => {
    const markup = await frontPageAt("2026-11-05T22:00:00Z");
    expect(markup).not.toContain("launch-clock");
    expect(markup).not.toContain("Launch watch");
    expect(text(markup)).toContain("The latest readings");
  });
});
