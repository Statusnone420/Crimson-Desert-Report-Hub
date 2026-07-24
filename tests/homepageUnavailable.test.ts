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

const emptyClaimEvidenceOutage = {
  total: 0,
  topClusters: [],
  currentPatch: {
    version: "1.13.01",
    publishedAt: "2026-07-08T05:51:00.000Z",
    officialUrl: "https://example.com/patch-notes",
  },
  claimedFixes: [],
  claimsUnavailable: false,
  evidenceUnavailable: true,
  sourceLeadsUnavailable: true,
  publicLeadsUnavailable: true,
  latestReportAt: null,
  observations: { coverage: [], asks: [] },
};

describe("homepage independent-register outages", () => {
  beforeEach(() => {
    mocks.getDashboardData.mockResolvedValue(emptyClaimEvidenceOutage);
    mocks.getDailySignalRollup.mockResolvedValue(null);
    mocks.getPublicScannerData.mockResolvedValue({
      reviewedThisWeek: 9,
      keptThisWeek: 3,
      published: 1,
      steamPulse: [],
      platformContext: null,
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

  it("shows a successful zero claims read as zero during an evidence outage", async () => {
    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain(
      '<span>Claimed fixes</span><span class="record-block__value">0</span>',
    );
    expect(markup).not.toContain(
      '<span>Claimed fixes</span><span class="record-block__value">unreadable</span>',
    );
  });

  it("shows claims as unreadable only when the claims read itself failed", async () => {
    mocks.getDashboardData.mockResolvedValue({
      ...emptyClaimEvidenceOutage,
      claimsUnavailable: true,
    });

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain(
      '<span>Claimed fixes</span><span class="record-block__value">unreadable</span>',
    );
  });

  it("keeps independently read radar totals visible during an evidence outage", async () => {
    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain('<div class="pulse-stat__value">3</div>');
    expect(markup).toContain("Public leads kept by the radar this week, out of 9 reviewed.");
  });
});
