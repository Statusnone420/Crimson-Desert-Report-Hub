import { Children, createElement, isValidElement, type ComponentProps, type ReactNode } from "react";
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
import { IssueBoard } from "@/components/newspaper/IssueBoard";

function boardProps(node: ReactNode): unknown {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === IssueBoard) return node.props;
  return Children.toArray(node.props.children).map(boardProps).find((props) => props !== undefined);
}

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
      byKind: { have_it: { count: 0 }, not_happening: { count: 0 } },
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
 * Public watchlist counts describe only topics readers can browse. Internal
 * monitored entries do not inflate the count or expose maintenance wording.
 */
describe("issue board counts only browseable watchlist topics", () => {
  beforeEach(() => {
    mocks.getLatestPublicScanMeta.mockResolvedValue(null);
  });

  it("does not serialize monitored topics with negative check-ins into client props", async () => {
    mocks.getIssuesData.mockResolvedValue(issuesData([
      publishedCluster(),
      cluster({
        id: "held-negative",
        title: "Internal monitored title",
        description: "Internal monitored description",
        confirmations: { totalCount: 1, byKind: { have_it: { count: 0 }, not_happening: { count: 1 } } },
      }),
    ]));
    const props = boardProps(await IssuesPage());
    expect(props).toBeDefined();
    const serialized = JSON.stringify(props);
    expect(serialized).toContain("cluster-published");
    expect(serialized).not.toContain("held-negative");
    expect(serialized).not.toContain("Internal monitored");
  });

  it("counts visible topics without exposing the monitored remainder", async () => {
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

    // Only the two browseable topics belong in the public watchlist count.
    expect(markup).toContain("2 public watchlist topics available to browse.");
    expect(markup).not.toContain("Monitoring");
    expect(markup).not.toContain("no public title");
    expect(markup).not.toContain("Monitored held-");
  });

  it("keeps the visible count when nothing is held back", async () => {
    mocks.getIssuesData.mockResolvedValue(
      issuesData([publishedCluster(), shownWatchlistCluster("shown-a"), shownWatchlistCluster("shown-b")]),
    );

    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("2 public watchlist topics available to browse.");
    // With a zero remainder the monitored line must not render at all — never
    // "Monitoring 0 additional watchlist issues."
    expect(markup).not.toContain("Monitoring");
  });

  it("inflects a single browseable topic", async () => {
    mocks.getIssuesData.mockResolvedValue(
      issuesData([shownWatchlistCluster("shown-a"), monitoredCluster("held-a")]),
    );

    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("1 public watchlist topic available to browse.");
    expect(markup).not.toContain("Monitoring");
    expect(markup).not.toContain("watchlist issues.");
  });

  it("puts the empty published state before the watchlist and offers its topics", async () => {
    mocks.getIssuesData.mockResolvedValue(issuesData([shownWatchlistCluster("shown-a")]));
    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("Browse 1 watchlist topic");
    expect(markup.indexOf("No published issues yet")).toBeLessThan(markup.indexOf('class="watch-index"'));
    expect(markup).toContain("Read the patch record");
  });

  it("keeps the patch record as recovery when both public views are empty", async () => {
    mocks.getIssuesData.mockResolvedValue(issuesData([]));
    const markup = renderToStaticMarkup(await IssuesPage());

    expect(markup).toContain("No published issues yet");
    expect(markup).toContain("Read the patch record");
    expect(markup).not.toContain("Browse 0 watchlist topics");
  });
});
