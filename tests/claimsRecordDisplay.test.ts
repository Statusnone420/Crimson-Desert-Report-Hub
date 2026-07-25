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
    claimedFixTotal: null,
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

/**
 * Claims group under the source's own section headings — consecutive runs in
 * source order, never re-sorted — and a capped register says so instead of
 * passing the first 30 off as the whole list. Legacy data (null sections, null
 * total) must degrade to the exact flat record shipped before the migration.
 */
describe("claims record section grouping and truncation honesty", () => {
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

  it("labels consecutive section runs in source order, desktop-only", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "Fixed an issue where bosses turned transparent.", category: null, section: "Content" },
          { fixText: "Fixed an issue where crops stopped growing.", category: null, section: "Content" },
          { fixText: "Fixed an issue where the crosshair lingered.", category: null, section: "Controls" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, 'class="claim-group__label dispatch-desktop-only"')).toBe(2);
    expect(markup.indexOf(">Content</h3>")).toBeGreaterThan(-1);
    expect(markup.indexOf(">Content</h3>")).toBeLessThan(markup.indexOf(">Controls</h3>"));
    // Grouping never disturbs the shared intro or the row set.
    expect(count(markup, "claims-intro")).toBe(1);
    expect(markup).toContain("No player verdicts on any of these 3 claims yet");
  });

  it("leaves a null-section run unlabeled so legacy rows degrade to the flat list", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "Fixed an issue where bosses turned transparent.", category: null, section: "Content" },
          { fixText: "Fixed an issue where crops stopped growing.", category: null, section: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, 'class="claim-group__label dispatch-desktop-only"')).toBe(1);
  });

  it("renders the pre-migration record byte-flat when nothing carries a section", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "Fixed a claimed issue one.", category: null, section: null },
          { fixText: "Fixed a claimed issue two.", category: null, section: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "claim-group__label")).toBe(0);
    expect(markup).not.toContain("Showing the first");
  });

  it("says a capped register is capped — and reports the source total in the hero", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixTotal: 40,
        claimedFixes: [
          { fixText: "Fixed a claimed issue one.", category: null, section: "Content" },
          { fixText: "Fixed a claimed issue two.", category: null, section: "Content" },
          { fixText: "Fixed a claimed issue three.", category: null, section: "Others" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "Showing the first 3 of 40 official fixes.")).toBe(1);
    // Every other surface keeps the stored register count: one number story
    // per viewport, with the cap line as the single truncation disclosure.
    expect(markup).toContain("Pearl Abyss lists 3 claimed fixes.");
    expect(markup).not.toContain("lists 40 claimed");
  });

  it("never renders the cap line when the register is complete", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixTotal: 2,
        claimedFixes: [
          { fixText: "Fixed a claimed issue one.", category: null, section: "Content" },
          { fixText: "Fixed a claimed issue two.", category: null, section: "Content" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).not.toContain("Showing the first");
    expect(markup).toContain("Pearl Abyss lists 2 claimed fixes.");
  });
});

/**
 * Official bracket tags ("[PS5] Fixed…") render as a style-C overline chip:
 * the tag's characters above the quote, the remainder inside it. Anything
 * that is not exactly one leading short tag renders verbatim — the record
 * never invents metadata the source didn't write.
 */
describe("claims record bracket-tag chips", () => {
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

  it("splits a leading bracket tag into an overline chip above the quote", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          {
            fixText: "[Oongka/Damiane] Fixed an issue where the lock status of equipped gear would not be saved.",
            category: null,
            section: "Content",
          },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, 'class="claim-tag"')).toBe(1);
    expect(markup).toContain('<span class="claim-tag">Oongka/Damiane</span>');
    // The quote keeps the remainder verbatim; the raw bracket text is gone.
    expect(markup).toContain("Fixed an issue where the lock status of equipped gear would not be saved.");
    expect(markup).not.toContain("[Oongka/Damiane]");
  });

  it("renders untagged rows exactly as before", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "Fixed an issue where crops stopped growing.", category: null, section: "Content" },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "claim-tag")).toBe(0);
    expect(markup).toContain("Fixed an issue where crops stopped growing.");
  });

  it("chips only the leading tag — mid-quote brackets stay in the quote", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          {
            fixText: "[PS5] Fixed an issue where the [Interact] prompt would not appear.",
            category: null,
            section: "Controls",
          },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(markup).toContain('<span class="claim-tag">PS5</span>');
    expect(markup).toContain("Fixed an issue where the [Interact] prompt would not appear.");
  });

  it("never chips an over-long, empty, or nested-bracket prefix", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          {
            fixText:
              "[This bracketed preamble runs far past the forty character tag limit] Fixed an issue with saving.",
            category: null,
            section: null,
          },
          { fixText: "[] Fixed an issue where empty tags appeared.", category: null, section: null },
          { fixText: "[A [nested] tag] Fixed an issue with brackets.", category: null, section: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    // All three render verbatim, brackets and all — no chip is invented.
    expect(count(markup, "claim-tag")).toBe(0);
    expect(markup).toContain(
      "[This bracketed preamble runs far past the forty character tag limit] Fixed an issue with saving.",
    );
    expect(markup).toContain("[] Fixed an issue where empty tags appeared.");
    expect(markup).toContain("[A [nested] tag] Fixed an issue with brackets.");
  });

  it("never chips a tag that has no quote text after it", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [{ fixText: "[Only a tag and nothing else]", category: null, section: null }],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "claim-tag")).toBe(0);
    expect(markup).toContain("[Only a tag and nothing else]");
  });

  it("renders a double leading tag fully verbatim instead of half-splitting", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          { fixText: "[PS5] [Xbox] Fixed a double-tag line in certain situations.", category: null, section: null },
          { fixText: "[PS5] [Xbox]", category: null, section: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    // A half-split would chip "PS5" and put raw "[Xbox]" back at the head of
    // the quote — the exact spill the chip removes. Verbatim instead.
    expect(count(markup, "claim-tag")).toBe(0);
    expect(markup).toContain("[PS5] [Xbox] Fixed a double-tag line in certain situations.");
    expect(markup).toContain("[PS5] [Xbox]");
  });

  it("never chips a whitespace-only tag or a whitespace-only remainder", async () => {
    mocks.getDashboardData.mockResolvedValue(
      dashboardData({
        claimedFixes: [
          // The regex alone accepts both of these; only the trim guards
          // reject them. Without the guards the first renders an empty
          // overline chip and the second a chip over an empty quote.
          { fixText: "[ ] Fixed an issue where whitespace tags appeared.", category: null, section: null },
          { fixText: "[PS5]   ", category: null, section: null },
        ],
      }),
    );

    const markup = renderToStaticMarkup(await DispatchHomePage());

    expect(count(markup, "claim-tag")).toBe(0);
    expect(markup).toContain("[ ] Fixed an issue where whitespace tags appeared.");
    expect(markup).toContain("[PS5]");
  });
});
