import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(async (): Promise<unknown> => ({})),
  getPublicScannerData: vi.fn(async (): Promise<unknown> => ({})),
  getPatchRadarData: vi.fn(async (): Promise<unknown> => ({})),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/queries", () => ({
  getDashboardData: mocks.getDashboardData,
  getPublicScannerData: mocks.getPublicScannerData,
}));
vi.mock("@/lib/radar.server", () => ({ getPatchRadarData: mocks.getPatchRadarData }));

import HomePage from "@/app/page";

const currentPatch = {
  version: "1.13.01",
  publishedAt: "2026-07-08T05:51:00.000Z",
  officialUrl: "https://example.com/patch-notes",
  source: "official",
};

function publishedCluster(overrides: Record<string, unknown> = {}) {
  return {
    id: "cluster-published",
    slug: "fps-regression",
    title: "FPS regression since 1.13",
    category: "performance",
    description: "",
    strengthScore: 4,
    directReportCount: 2,
    signalCount: 0,
    candidateSignalCount: 0,
    fix_claimed_at: null,
    fix_claimed_patch_version: null,
    reportPlatformCounts: {},
    confirmations: { totalCount: 1, byPlatform: {}, byKind: { have_it: { count: 1 } }, pollFixedCount: 0, pollStillCount: 0 },
    readout: { state: "confirmed", label: "Player-reported", tone: "crimson", sentence: "2 player reports on this patch.", ask: null, poll: null },
    ...overrides,
  };
}

function dashboardData(topClusters: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    total: topClusters.reduce<number>((count, cluster) => count + ((cluster as { directReportCount?: number }).directReportCount ?? 0), 0),
    topClusters,
    currentPatch,
    claimedFixes: [],
    claimedFixTotal: null,
    claimsUnavailable: false,
    evidenceUnavailable: false,
    sourceLeadsUnavailable: false,
    publicLeadsUnavailable: false,
    observations: { coverage: [], asks: [] },
    ...overrides,
  };
}

describe("homepage keeps issue publication separate from headline selection", () => {
  beforeEach(() => {
    // The expansion article intentionally takes over on September 5. These
    // assertions exercise the still-supported current-patch fallback.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    mocks.getPublicScannerData.mockResolvedValue({ steamPulse: [], pulseReadFailures: [] });
    mocks.getPatchRadarData.mockResolvedValue({ connected: false });
  });

  afterEach(() => vi.useRealTimers());

  it("keeps a published issue title on the board instead of promoting it", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([publishedCluster()]));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Patch 1.13.01: the official fixes and player record.");
    expect(markup).toContain("All 1 published issue →");
    expect(markup).not.toContain("FPS regression since 1.13");
  });

  it("does not promote a watchlist title after a patch rollover", async () => {
    const rolledOver = publishedCluster({ id: "cluster-rolled-over", strengthScore: 0, directReportCount: 0, confirmations: { totalCount: 0, byPlatform: {}, byKind: { have_it: { count: 0 } }, pollFixedCount: 0, pollStillCount: 0 }, readout: { state: "watching", label: "Open", tone: "dim", sentence: "The scanner checks public sources every run. Nothing's turned up this patch.", ask: null, poll: null } });
    mocks.getDashboardData.mockResolvedValue(dashboardData([rolledOver]));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("All 0 published issues →");
    expect(markup).not.toContain("FPS regression since 1.13");
  });

  it("never promotes a lone vague report or invents a stronger title", async () => {
    const vagueTitle = "Real bad mechanic issue got bugged in recent update";
    mocks.getDashboardData.mockResolvedValue(dashboardData([publishedCluster({ title: vagueTitle, directReportCount: 1 })]));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("All 1 published issue →");
    expect(markup).not.toContain(vagueTitle);
    expect(markup).not.toContain("board-lead");
  });

  it("keeps the issue count separate from the report count", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([publishedCluster({ directReportCount: 6 })]));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("6 reports this patch");
    expect(markup).toContain("All 1 published issue →");
    expect(markup).not.toContain("All 6 published issues");
  });

  it("keeps the fallback patch state when the current patch cannot be verified", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([], { currentPatch: { ...currentPatch, source: "fallback" } }));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("The current patch could not be verified.");
    expect(markup).toContain('href="/patches"');
    expect(markup).not.toContain("Beyond Pywel’s");
  });

  it("renders the public observation lanes without exposing unrelated signal registers", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([], {
      publicFindings: [{ title: "Private scanner lead", sourceUrl: "https://internal.example/private" }],
      observations: {
        coverage: [{ id: "coverage-1", title: "Published patch coverage", snippet: "A dated public article.", sourceDomain: "example.com", url: "https://example.com/coverage", timestamp: { value: "2026-09-03T00:00:00.000Z" } }],
        asks: [{ id: "ask-1", title: "A public community request", snippet: "Players are asking for a change.", sourceDomain: "community.example", url: "https://community.example/ask", timestamp: { value: "2026-09-02T00:00:00.000Z" } }],
      },
    }));
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Published patch coverage");
    expect(markup).toContain("A public community request");
    expect(markup).not.toContain("Private scanner lead");
    expect(markup).not.toContain("internal.example/private");
  });
});
