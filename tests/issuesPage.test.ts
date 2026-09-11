import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIssuesData: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/queries", () => ({ getIssuesData: mocks.getIssuesData }));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

import IssuesPage from "@/app/issues/page";

it("marks an old watchlist description as history beside a current-patch fix claim", async () => {
  const description = "Watchlist item for crashes to desktop/home and launch hangs after patch 1.13.00. It remains unverified until approved reports or public signals confirm it.";
  mocks.getIssuesData.mockResolvedValue({
    currentPatch: { version: "2.02.00" },
    excerptsByCluster: {},
    signalsByCluster: {},
    clusters: [{
      id: "crash-startup",
      title: "Crashes and startup hangs",
      category: "crash_startup",
      description,
      strengthScore: 0,
      directReportCount: 0,
      signalCount: 0,
      candidateSignalCount: 0,
      reportPlatformCounts: {},
      confirmations: { totalCount: 0, byPlatform: {}, pollFixedCount: 0, pollStillCount: 0 },
      readout: {
        label: "Fix claimed — unverified",
        tone: "muted",
        sentence: "Pearl Abyss says 2.02.00 fixed this. Quiet can mean fixed — or just quiet.",
        ask: null,
        poll: { fixedCount: 0, stillCount: 0 },
      },
    }],
  });
  const markup = renderToStaticMarkup(await IssuesPage());
  expect(markup).toContain("2.02.00");
  expect(markup).toContain("Historical watchlist note (Patch 1.13.00): crashes to desktop/home and launch hangs.");
  expect(markup).toContain("Pearl Abyss says 2.02.00 fixed this.");
  expect(markup).toContain("0 player reports");
  expect(markup).not.toContain("launch hangs after patch 1.13.00");
});
