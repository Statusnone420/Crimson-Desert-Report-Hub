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
    strengthScore: 1,
    directReportCount: 1,
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
      state: "confirmed",
      label: "Player-reported",
      tone: "crimson",
      sentence: "1 player report on this patch.",
      ask: null,
      poll: null,
      ...readout,
    },
    ...rest,
  };
}

function dashboardData(overrides: Record<string, unknown> = {}) {
  return {
    total: 1,
    topClusters: [],
    currentPatch,
    claimedFixes: [],
    claimsUnavailable: false,
    evidenceUnavailable: false,
    sourceLeadsUnavailable: false,
    publicLeadsUnavailable: false,
    latestReportAt: null,
    observations: { coverage: [], asks: [] },
    ...overrides,
  };
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/**
 * The Claims Record renders one shared status line instead of repeating the
 * same clock sentence on every row — but only when the rows genuinely share a
 * state. Divergent clock dates keep their honest row-level clocks, and each
 * failure register keeps its own single statement.
 */
describe("claims record consolidated status line", () => {
  beforeEach(() => {
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

  it("collapses uniformly quiet claims into one dated statement with a Method link", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "Fixed a claimed issue one.", category: null },
          { fixText: "Fixed a claimed issue two.", category: null },
          { fixText: "Fixed a claimed issue three.", category: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("No player verdicts on any of these 3 claims yet");
    expect(markup).toContain("running since JUL 8");
    expect(markup).toContain('href="/about#claim-clock"');
    expect(count(markup, "claims-intro")).toBe(1);
    // The repeated per-row clock is gone when every quiet claim shares a date,
    // and with no bars on the page the shared line already covers every row —
    // no per-row marker repeats it.
    expect(markup).not.toContain("No player verdicts yet · claim clock running since");
    expect(markup).not.toContain("No verdicts yet");
  });

  it("summarizes an all-answered record without inventing quiet rows", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-08T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            confirmations: { totalCount: 3, pollFixedCount: 2, pollStillCount: 1 },
            readout: {
              state: "players_say_fixed",
              label: "Players say fixed",
              tone: "green",
              poll: { fixedCount: 2, stillCount: 1, escalated: true },
            },
          }),
        ],
        claimedFixes: [{ fixText: "Fixed an issue where the map crashed.", category: "crash_startup" }],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("Players have answered the claim below");
    expect(markup).toContain("verdict-bar");
    expect(markup).toContain("Leaning fixed.");
    // No quiet row exists: no clock, no marker, nothing invented.
    expect(markup).not.toContain("No player verdicts");
    expect(markup).not.toContain("No verdicts yet");
  });

  it("keeps voted rows as rendered exceptions while summarizing the quiet rest", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-08T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            confirmations: { totalCount: 3, pollFixedCount: 1, pollStillCount: 2 },
            readout: {
              state: "still_happening",
              label: "Still happening",
              poll: { fixedCount: 1, stillCount: 2, escalated: false },
            },
          }),
        ],
        claimedFixes: [
          { fixText: "Fixed an issue where the map crashed.", category: "crash_startup" },
          { fixText: "Fixed an issue where performance dropped.", category: "performance" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("Players have answered 1 of these 2 claims; the other one has no verdicts yet");
    expect(markup).toContain("claim clock");
    expect(markup).toContain("running since JUL 8");
    // The poll-scoping rule renders once, in the shared line, whenever a bar is on the page.
    expect(count(markup, "Verdicts count taps made after the clock, this patch only.")).toBe(1);
    // The voted row keeps its verdict bar and a short reading — the shared
    // clock-rule tail no longer repeats under every bar.
    expect(markup).toContain("verdict-bar");
    expect(markup).toContain("Contested.");
    expect(markup).not.toContain("Verdicts count taps made after the claim clock, this patch only.");
    expect(markup).not.toContain("No player verdicts yet · claim clock running since");
    // The quiet row keeps a mobile-only marker for the one-row <900px cut.
    expect(markup).toContain('class="verdict-clock dispatch-mobile-only"');
    expect(markup).toContain("No verdicts yet");
  });

  it("retains row-level clocks when quiet claims carry different clock dates", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-10T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
          cluster({
            id: "cluster-fps",
            slug: "fps-regression",
            title: "FPS regression since 1.13",
            category: "performance",
            fix_claimed_at: "2026-07-12T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
        ],
        claimedFixes: [
          { fixText: "Fixed an issue where the map crashed.", category: "crash_startup" },
          { fixText: "Fixed an issue where performance dropped.", category: "performance" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    // Different states are never flattened into one sentence: each row keeps
    // its own clock, and the shared line explains why without pointing at
    // rows a narrow viewport may hide.
    expect(markup).toContain("No player verdicts on any of these 2 claims yet");
    expect(markup).toContain("they were recorded on different days, so each carries its own");
    expect(markup).toContain("claim clock running since JUL 10");
    expect(markup).toContain("claim clock running since JUL 12");
    expect(count(markup, "No player verdicts yet · claim clock running since")).toBe(2);
    // No bar on the page, so the poll-scoping tail stays out of the line.
    expect(markup).not.toContain("Verdicts count taps made after the clock");
  });

  it("keeps the poll-scoping rule in the shared line when divergent clocks meet a voted row", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-08T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            confirmations: { totalCount: 3, pollFixedCount: 1, pollStillCount: 2 },
            readout: {
              state: "still_happening",
              label: "Still happening",
              poll: { fixedCount: 1, stillCount: 2, escalated: false },
            },
          }),
          cluster({
            id: "cluster-fps",
            slug: "fps-regression",
            title: "FPS regression since 1.13",
            category: "performance",
            fix_claimed_at: "2026-07-12T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
          cluster({
            id: "cluster-mount",
            slug: "mount-lockups",
            title: "Mount and input lockups",
            category: "controls_gameplay",
            fix_claimed_at: "2026-07-14T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
        ],
        claimedFixes: [
          { fixText: "Fixed an issue where the map crashed.", category: "crash_startup" },
          { fixText: "Fixed an issue where performance dropped.", category: "performance" },
          { fixText: "Fixed an issue where mounts locked up.", category: "controls_gameplay" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("No player verdicts yet on 2 of these 3 claims");
    expect(markup).toContain("they were recorded on different days, so each carries its own");
    expect(count(markup, "Verdicts count taps made after the clock, this patch only.")).toBe(1);
    expect(markup).toContain("verdict-bar");
    expect(count(markup, "No player verdicts yet · claim clock running since")).toBe(2);
  });

  it("reads singular for a lone quiet claim", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [{ fixText: "Fixed the only claimed issue.", category: null }],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain("No player verdicts on this claim yet");
    expect(markup).toContain("running since JUL 8");
    expect(markup).not.toContain("any of these");
  });

  it("states an evidence outage once for the whole section, never per row", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        total: 0,
        evidenceUnavailable: true,
        sourceLeadsUnavailable: true,
        publicLeadsUnavailable: true,
        claimedFixes: [
          { fixText: "Fixed a claimed issue one.", category: null },
          { fixText: "Fixed a claimed issue two.", category: null },
          { fixText: "Fixed a claimed issue three.", category: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    // Claims are an independent register: the quotes stay on the page.
    expect(markup).toContain("Fixed a claimed issue one.");
    expect(markup).toContain("Fixed a claimed issue three.");
    expect(count(markup, "not counted as zero")).toBe(1);
    // A failed read never renders a running clock or a quiet marker — either
    // would imply a countable quiet the register cannot back.
    expect(markup).not.toContain("claim clock running since");
    expect(markup).not.toContain("No verdicts yet");
  });

  it("points at the issue board once when polls exist but no claim maps 1:1", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-08T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
        ],
        claimedFixes: [
          { fixText: "Fixed one crash issue.", category: "crash_startup" },
          { fixText: "Fixed another crash issue.", category: "crash_startup" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "tracked per issue on the")).toBe(1);
    expect(markup).toContain("these exact lines");
    // Untied verdicts must never render a countable quiet on any row.
    expect(markup).not.toContain("claim clock running since");
    expect(markup).not.toContain("No verdicts yet");
  });

  it("keeps the issue-board pointer singular for a single unmapped claim", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        topClusters: [
          cluster({
            id: "cluster-crash",
            slug: "map-open-crash",
            title: "Map-open crash persists after fix",
            category: "crash_startup",
            fix_claimed_at: "2026-07-08T06:00:00.000Z",
            fix_claimed_patch_version: "1.13.01",
            readout: {
              state: "fix_claimed_unverified",
              label: "Fix claimed — unverified",
              tone: "amber",
              poll: { fixedCount: 0, stillCount: 0, escalated: false },
            },
          }),
        ],
        claimedFixes: [{ fixText: "Improved overall stability.", category: null }],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "tracked per issue on the")).toBe(1);
    expect(markup).toContain("this exact line");
    expect(markup).not.toContain("these exact lines");
  });
});
