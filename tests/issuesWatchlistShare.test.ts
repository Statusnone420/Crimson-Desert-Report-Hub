import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIssuesData: vi.fn(async (): Promise<unknown> => ({})),
  getLatestPublicScanMeta: vi.fn(async (): Promise<unknown> => null),
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
vi.mock("@/components/ConfirmButtons", () => ({
  ConfirmButtons: () => createElement("div", null, "confirm"),
}));
vi.mock("@/lib/queries", () => ({
  getIssuesData: mocks.getIssuesData,
  getLatestPublicScanMeta: mocks.getLatestPublicScanMeta,
}));

import IssuesPage from "@/app/issues/page";

const currentPatch = {
  version: "1.13.01",
  publishedAt: "2026-07-08T05:51:00.000Z",
  officialUrl: "https://example.com/patch-notes",
};

type ClusterOverrides = Record<string, unknown> & {
  confirmations?: Record<string, unknown>;
  readout?: Record<string, unknown>;
};

function cluster(overrides: ClusterOverrides = {}) {
  const { confirmations, readout, ...rest } = overrides;
  return {
    id: "cluster-1",
    slug: "cluster-1",
    title: "Sample issue",
    category: "performance",
    description: "",
    strengthScore: 0,
    directReportCount: 0,
    signalCount: 0,
    candidateSignalCount: 0,
    fix_claimed_at: null,
    fix_claimed_patch_version: null,
    reportPlatformCounts: {},
    confirmations: {
      totalCount: 0,
      byPlatform: {},
      byKind: { have_it: { count: 0 } },
      pollFixedCount: 0,
      pollStillCount: 0,
      ...confirmations,
    },
    readout: {
      state: "watching",
      label: "Open",
      tone: "dim",
      sentence: "The scanner checks public sources every run. Nothing's turned up this patch.",
      ask: null,
      poll: null,
      ...readout,
    },
    ...rest,
  };
}

/** Passes needsFullIssueCard, so it lands in the published tier, not the watchlist. */
function publishedCluster() {
  return cluster({
    id: "cluster-published",
    title: "FPS regression since 1.13",
    strengthScore: 4,
    directReportCount: 2,
    readout: { state: "confirmed", label: "Player-reported", tone: "crimson", sentence: "2 player reports on this patch." },
  });
}

/** A watchlist entry the Radar leads section renders (it has candidate signals). */
function shownWatchlistCluster(id: string) {
  return cluster({ id, title: `Shown ${id}`, candidateSignalCount: 2 });
}

/** A watchlist entry held back into the monitored remainder (no candidate signals). */
function monitoredCluster(id: string) {
  return cluster({ id, title: `Monitored ${id}`, candidateSignalCount: 0 });
}

function issuesData(clusters: unknown[]) {
  return { clusters, excerptsByCluster: {}, signalsByCluster: {}, currentPatch };
}

/**
 * The watchlist splits into the entries the board renders and a monitored
 * remainder. Each half states its own share of the total, so a reader never has
 * to subtract one number from another to learn how much is being held back.
 */
describe("issue board states each half of the watchlist's share", () => {
  beforeEach(() => {
    mocks.getLatestPublicScanMeta.mockResolvedValue(null);
  });

  it("names shown and remaining counts when entries are held back", async () => {
    mocks.getIssuesData.mockResolvedValue(
      issuesData([
        publishedCluster(),
        shownWatchlistCluster("shown-a"),
        shownWatchlistCluster("shown-b"),
        monitoredCluster("held-a"),
        monitoredCluster("held-b"),
        monitoredCluster("held-c"),
      ]),
    );

    const markup = renderToStaticMarkup(await IssuesPage());

    // Watchlist total is 5: two rendered, three held back. The published entry
    // is not part of it.
    expect(markup).toContain("Showing 2 of 5 watchlist issues");
    expect(markup).toContain("Monitoring 3 additional watchlist issues.");
  });

  it("says the whole watchlist is shown when nothing is held back", async () => {
    mocks.getIssuesData.mockResolvedValue(
      issuesData([publishedCluster(), shownWatchlistCluster("shown-a"), shownWatchlistCluster("shown-b")]),
    );

    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("Showing 2 of 2 watchlist issues");
    // With a zero remainder the monitored line must not render at all — never
    // "Monitoring 0 additional watchlist issues."
    expect(markup).not.toContain("Monitoring");
  });

  it("inflects both halves at one", async () => {
    mocks.getIssuesData.mockResolvedValue(
      issuesData([shownWatchlistCluster("shown-a"), monitoredCluster("held-a")]),
    );

    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("Showing 1 of 2 watchlist issues");
    expect(markup).toContain("Monitoring 1 additional watchlist issue.");
    expect(markup).not.toContain("watchlist issues.");
  });
});
