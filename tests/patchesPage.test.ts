import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDashboardData: vi.fn(async (): Promise<unknown> => ({})) }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/queries", () => ({ getDashboardData: mocks.getDashboardData }));

import PatchesPage from "@/app/patches/page";

function dashboardData(overrides: Record<string, unknown> = {}) {
  return {
    total: 2,
    topClusters: [],
    currentPatch: { version: "1.13.01", officialUrl: "https://example.com/official", summary: null },
    claimedFixes: [{ fixText: "Fixed an issue where the map did not load.", category: "controls_gameplay", section: "Controls" }],
    claimedFixTotal: 1,
    claimsUnavailable: false,
    evidenceUnavailable: false,
    ...overrides,
  };
}

describe("patch desk", () => {
  beforeEach(() => mocks.getDashboardData.mockResolvedValue(dashboardData()));

  it("renders only the stored official claim and live player-record totals", async () => {
    const markup = renderToStaticMarkup(await PatchesPage());
    expect(markup).toContain("Patch 1.13.01");
    expect(markup).toContain("Fixed an issue where the map did not load.");
    expect(markup).toContain("Player reports this patch");
    expect(markup).toContain('href="https://example.com/official"');
    expect(markup).not.toContain("September");
  });

  it("does not turn an unread official register into zero claims", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData({ claimedFixes: [], claimsUnavailable: true }));
    const markup = renderToStaticMarkup(await PatchesPage());
    expect(markup).toContain("The official claims record is unavailable.");
    expect(markup).toContain("This is not a report of zero claimed fixes.");
    expect(markup).toContain("Claim verdicts unavailable");
    expect(markup).not.toContain("0 claims have more players saying it still happens");
    expect(markup).not.toContain("Showing 0 of 0 stored official fix claims");
  });

  it("handles a legacy dashboard fixture without a source total", async () => {
    mocks.getDashboardData.mockResolvedValue(dashboardData({ claimedFixTotal: undefined }));
    const markup = renderToStaticMarkup(await PatchesPage());
    expect(markup).toContain("Showing 1 of 1 stored official fix claims");
    expect(markup).not.toContain("Showing the first");
  });
});
