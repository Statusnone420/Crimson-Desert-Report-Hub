import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(async (): Promise<unknown> => ({})),
  getDailySignalRollup: vi.fn(async (): Promise<unknown> => null),
  getPublicScannerData: vi.fn(async (): Promise<unknown> => ({})),
  getPatchRadarData: vi.fn(async (): Promise<unknown> => ({})),
  getTrackedPatchEditionCount: vi.fn(async () => 1),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/queries", () => ({
  getDashboardData: mocks.getDashboardData,
  getDailySignalRollup: mocks.getDailySignalRollup,
  getPublicScannerData: mocks.getPublicScannerData,
}));
vi.mock("@/lib/radar.server", () => ({
  getPatchRadarData: mocks.getPatchRadarData,
}));
vi.mock("@/lib/officialPatch.server", () => ({
  getTrackedPatchEditionCount: mocks.getTrackedPatchEditionCount,
}));

import DispatchHomePage from "@/app/page";

const currentPatch = {
  version: "1.13.01",
  publishedAt: "2026-07-08T05:51:00.000Z",
  officialUrl: "https://example.com/patch-notes",
};

/** A cluster carrying evidence, so the published gate accepts it. */
function publishedCluster() {
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
    readout: {
      state: "confirmed",
      label: "Player-reported",
      tone: "crimson",
      sentence: "2 player reports on this patch.",
      ask: null,
      poll: null,
    },
  };
}

/**
 * The same cluster after a patch-family rollover: it is still public, so the
 * cluster read returns it, but every per-patch count has reset to zero, so the
 * published gate rejects it. This is an ordinary state, not an outage — no
 * unavailable flag is set anywhere.
 */
function rolledOverCluster() {
  return {
    ...publishedCluster(),
    id: "cluster-rolled-over",
    strengthScore: 0,
    directReportCount: 0,
    confirmations: { totalCount: 0, byPlatform: {}, byKind: { have_it: { count: 0 } }, pollFixedCount: 0, pollStillCount: 0 },
    readout: {
      state: "watching",
      label: "Open",
      tone: "dim",
      sentence: "The scanner checks public sources every run. Nothing's turned up this patch.",
      ask: null,
      poll: null,
    },
  };
}

function dashboardData(topClusters: unknown[]) {
  return {
    total: topClusters.length,
    topClusters,
    currentPatch,
    claimedFixes: [],
    claimedFixTotal: null,
    claimsUnavailable: false,
    evidenceUnavailable: false,
    sourceLeadsUnavailable: false,
    publicLeadsUnavailable: false,
    latestReportAt: null,
    observations: { coverage: [], asks: [] },
  };
}

/**
 * "Published" and "watchlist" are two different tiers in the locked public
 * vocabulary, and the hero headline names whichever tier its subject is
 * actually in. The entry it points at is NOT always published: when no cluster
 * passes the published gate, the headline falls back to the top public cluster,
 * which by definition sits on the watchlist.
 */
describe("homepage hero names the tier its subject belongs to", () => {
  beforeEach(() => {
    mocks.getDailySignalRollup.mockResolvedValue(null);
    mocks.getPublicScannerData.mockResolvedValue({
      reviewedThisWeek: 9,
      keptThisWeek: 3,
      published: 1,
      steamPulse: [],
      platformContext: null,
      readFailures: [],
      pulseReadFailures: [],
    });
    mocks.getPatchRadarData.mockResolvedValue({
      connected: false,
      daily: [],
      categories: [],
      weekly: [],
      recurrence: [],
      recurring: { trackedLeads: 0 },
    });
  });

  it("calls a published subject the board leader", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([publishedCluster()]));

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("FPS regression since 1.13 leads the 1.13.01 board.");
    expect(markup).not.toContain("leads the 1.13.01 watchlist.");
  });

  it("calls an unpublished subject the watchlist leader instead of contradicting the dek", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData([rolledOverCluster()]));

    const markup = renderToStaticMarkup(await DispatchHomePage());

    // The dek one line below reports zero published issues, so the headline
    // must not claim the same entry leads the board.
    expect(markup).toContain("The board is watching 0 published issues");
    expect(markup).toContain("leads the 1.13.01 watchlist.");
    expect(markup).not.toContain("leads the 1.13.01 board.");
  });
});
