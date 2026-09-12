import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIssuesData: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/queries", () => ({ getIssuesData: mocks.getIssuesData }));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

import IssuesPage from "@/app/issues/page";

function issueData() {
  const description = "Watchlist item for crashes to desktop/home and launch hangs after patch 1.13.00. It remains unverified until approved reports or public signals confirm it.";
  return {
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
        sentence: "The fix claim for 2.02.00 remains unverified. Quiet can mean fixed — or just quiet.",
        ask: null,
        poll: { fixedCount: 0, stillCount: 0 },
      },
    }],
  };
}

it("shows the exact official scope beside a broad historical issue", async () => {
  mocks.getIssuesData.mockResolvedValue({
    ...issueData(),
    officialClaimsByCluster: {
      "crash-startup": [{
        key: "a".repeat(64),
        text: "Fixed a crash when starting a new game with DLSS Frame Generation enabled.",
        section: "Graphics / Settings",
        officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=130",
      }],
    },
    officialClaimsUnavailable: false,
  });
  const markup = renderToStaticMarkup(await IssuesPage());
  expect(markup).toContain("2.02.00");
  expect(markup).toContain("Historical watchlist note (Patch 1.13.00): crashes to desktop/home and launch hangs.");
  expect(markup).not.toContain("Pearl Abyss says 2.02.00 fixed this.");
  expect(markup).toContain("starting a new game with DLSS Frame Generation enabled.");
  expect(markup).toContain(`/patches#claim-${"a".repeat(64)}`);
  expect(markup).toContain("Published issues");
  expect(markup).toContain("0 player reports");
  expect(markup).not.toContain("launch hangs after patch 1.13.00");
});


it("keeps legacy claim context explicit without inventing an exact pairing", async () => {
  mocks.getIssuesData.mockResolvedValue({ ...issueData(), officialClaimsByCluster: {}, officialClaimsUnavailable: false });
  const markup = renderToStaticMarkup(await IssuesPage());
  expect(markup).toContain("No confirmed official claim is attached to this issue.");
  expect(markup).toContain('href="/patches#claims"');
  expect(markup).not.toContain("fixed this");
  expect(markup).not.toContain("linked to this issue");
});

it("surfaces an unreadable claim context while retaining the public issue", async () => {
  mocks.getIssuesData.mockResolvedValue({ ...issueData(), officialClaimsByCluster: {}, officialClaimsUnavailable: true });
  const markup = renderToStaticMarkup(await IssuesPage());
  expect(markup).toContain("The exact official claim could not be read.");
  expect(markup).toContain("Crashes and startup hangs");
  expect(markup).not.toContain("No confirmed official claim is attached");
});
