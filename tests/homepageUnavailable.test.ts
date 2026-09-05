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

const evidenceOutage = {
  total: 0,
  topClusters: [],
  currentPatch: { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z", officialUrl: "https://example.com/patch-notes", source: "official" },
  claimedFixes: [],
  claimedFixTotal: null,
  claimsUnavailable: false,
  evidenceUnavailable: true,
  sourceLeadsUnavailable: true,
  publicLeadsUnavailable: true,
  observations: { coverage: [], asks: [] },
};

describe("homepage independent-register outages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    mocks.getDashboardData.mockResolvedValue(evidenceOutage);
    mocks.getPublicScannerData.mockResolvedValue({ steamPulse: [], pulseReadFailures: [] });
    mocks.getPatchRadarData.mockResolvedValue({ connected: false });
  });

  afterEach(() => vi.useRealTimers());

  it("shows a successful zero claims read as zero during an evidence outage", async () => {
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("<dt>Claimed fixes</dt><dd>0</dd>");
    expect(markup).toContain("The official record.");
    expect(markup).toContain("Report counts unavailable");
    expect(markup).toContain("<dt>Published issues</dt><dd>Unavailable</dd>");
    expect(markup).not.toContain("Official claims are unavailable.");
  });

  it("shows claims as unavailable only when the claims read itself failed", async () => {
    mocks.getDashboardData.mockResolvedValue({ ...evidenceOutage, claimsUnavailable: true });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Official claims are unavailable.");
    expect(markup).toContain("The claims read did not complete. No count is assumed to be zero.");
    expect(markup).toContain("<dt>Claimed fixes</dt><dd>Unavailable</dd>");
    expect(markup).not.toContain("<dt>Claimed fixes</dt><dd>0</dd>");
  });

  it("does not turn a claims read failure into invented claim cards or zero", async () => {
    mocks.getDashboardData.mockResolvedValue({ ...evidenceOutage, claimsUnavailable: true, evidenceUnavailable: false, publicLeadsUnavailable: false });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).not.toContain("No claimed fixes are recorded for this patch yet.");
    expect(markup).not.toContain("Browse the fix record →");
    expect(markup).toContain("Official claims are unavailable.");
  });

  it("keeps an independently read radar total visible during an evidence outage", async () => {
    mocks.getPatchRadarData.mockResolvedValue({
      connected: true,
      recurring: { trackedLeads: 3 },
      categories: [{ category: "performance", tracked: 3 }],
    });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("<dt>Tracked leads</dt><dd>3</dd>");
    expect(markup).toContain("3 scanner leads · not confirmed bugs");
    expect(markup).not.toContain("The scanner record could not be read.");
  });

  it("renders unread radar data as unavailable instead of zero", async () => {
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("<dt>Tracked leads</dt><dd>Unavailable</dd>");
    expect(markup).toContain("The scanner record could not be read. Counts are unavailable.");
    expect(markup).not.toContain("0 scanner leads · not confirmed bugs");
  });

  it("renders an unread Steam history as unavailable instead of a fabricated capture", async () => {
    mocks.getPublicScannerData.mockResolvedValue({ steamPulse: [], pulseReadFailures: ["steam"] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Steam review history could not be read.");
    expect(markup).not.toContain("No Steam review captures are available yet.");
    expect(markup).not.toContain("Total reviews</span>");
  });
});
