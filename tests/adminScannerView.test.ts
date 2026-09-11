import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { ScannerFeedbackDesk } from "@/components/scanner/ScannerFeedbackDesk";
import { emptyPatchRadarData } from "@/lib/radar.server";
import type { AdminObservationRow, AutomationRunRow, PublicScannerData } from "@/lib/queries";
import type { IntegrationStatus } from "@/lib/env";
import type { ScannerReadRegister } from "@/lib/scannerRegisters";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/actions", () => ({
  setScannerPolicy: vi.fn(),
  recordScannerDecision: vi.fn(),
  rejectObservationAndTeach: vi.fn(),
  undoScannerDecision: vi.fn(),
}));
vi.mock("@/components/ScanControls", () => ({ ScanControls: () => null }));

type InputProps = {
  children?: ReactNode;
  name?: string;
  min?: string;
  max?: string;
};

function findInput(node: ReactNode, name: string): ReactElement<InputProps> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<InputProps>;
  if (element.props.name === name) return element;
  for (const child of Children.toArray(element.props.children)) {
    const found = findInput(child, name);
    if (found) return found;
  }
  return null;
}

/**
 * A scoreboard whose reads all succeeded. Tests that are not about degraded
 * health need this: a placeholder object reads as `scannerConnected: undefined`,
 * which silently renders the unavailable branches instead of the ones under test.
 */
const healthyScoreboard = {
  reviewedThisWeek: 0,
  filteredThisWeek: 0,
  keptThisWeek: 0,
  awaiting: 0,
  published: 0,
  lastCheckedAt: null,
  scannerActive: true,
  scannerConnected: true,
  llmPaused: false,
  readFailures: [],
  steamPulse: [],
  platformContext: null,
  pulseReadFailures: [],
} satisfies PublicScannerData;

describe("AdminScannerView", () => {
  it("keeps the one-dollar AI limit and saved model choices inside the private form", () => {
    const view = AdminScannerView({
      runs: [],
      signals: [],
      rejectedCandidates: [],
      observations: [],
      observationPatch: { version: "1.14.00", publishedAt: null },
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: healthyScoreboard,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    });

    const input = findInput(view, "monthlyLlmUsdCap");
    expect(input?.props.min).toBe("0");
    expect(input?.props.max).toBe("1");
    const model = findInput(view, "modelPreset");
    expect(model?.type).toBe("select");
    expect(renderToStaticMarkup(view)).toContain("gpt_5_6_luna_flex");
  });

  it("freezes teaching-desk relative times at the server-captured instant", () => {
    const props = {
      nowIso: "2026-07-22T18:00:00.000Z",
      candidates: [{
        id: "candidate-1",
        run_id: null,
        title: "Candidate title",
        url: "https://example.com/candidate",
        source_domain: "example.com",
        source_published_at: null,
        snippet: "Candidate summary",
        reason: "off_topic",
        created_at: "2026-07-22T17:30:00.000Z",
        expires_at: "2026-07-22T19:30:00.000Z",
        rescued_at: null,
        decision_id: null,
        feedback_rule_id: null,
      }],
    };

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-22T18:00:00.000Z"));
      const serverMarkup = renderToStaticMarkup(createElement(ScannerFeedbackDesk, props));
      vi.setSystemTime(new Date("2026-07-22T19:00:00.000Z"));
      const hydrationMarkup = renderToStaticMarkup(createElement(ScannerFeedbackDesk, props));

      expect(hydrationMarkup).toBe(serverMarkup);
      expect(serverMarkup).toContain("discovered 30m ago");
      expect(serverMarkup).toContain("Expires in 2h");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps every retained lead reachable and gives each one an explicit teaching action", () => {
    const signals = Array.from({ length: 8 }, (_, index) => ({
      id: `signal-${index + 1}`,
      cluster_id: `cluster-${index + 1}`,
      source: "web_search",
      source_url: `https://example.com/lead-${index + 1}`,
      title: `Retained lead ${index + 1}`,
      summary: `Summary ${index + 1}`,
      category: "performance",
      confidence: "medium" as const,
      observed_at: "2026-07-22T17:00:00.000Z",
      public_status: "public" as const,
      source_type: "web_search",
      source_domain: "example.com",
      source_published_at: null,
      first_seen_at: "2026-07-22T17:00:00.000Z",
      last_seen_at: "2026-07-22T17:00:00.000Z",
      seen_count: 1,
    }));
    const markup = renderToStaticMarkup(createElement(AdminScannerView, {
      runs: [],
      signals,
      rejectedCandidates: [],
      observations: [],
      observationPatch: { version: "1.14.00", publishedAt: null },
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: healthyScoreboard,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    }));

    expect(markup).toContain("Retained lead 8");
    expect(markup).toContain("Browse 2 older leads");
    expect(markup.match(/name="target_kind" value="signal"/g)).toHaveLength(8);
    expect(markup.match(/Remove bad lead/g)).toHaveLength(8);
  });

  it("does not offer a shared-URL teaching action for a Steam review lead", () => {
    const markup = renderToStaticMarkup(createElement(AdminScannerView, {
      runs: [],
      signals: [{
        id: "signal-steam-review",
        cluster_id: "cluster-performance",
        source: "steam_review",
        source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert/#app_reviews_hash",
        title: "Crimson Desert player issue on Steam",
        summary: "A private Steam review described a performance problem.",
        category: "performance",
        confidence: "medium" as const,
        observed_at: "2026-07-22T17:00:00.000Z",
        public_status: "private" as const,
        source_type: "steam_review",
        source_domain: "store.steampowered.com",
        source_published_at: "2026-07-22T16:00:00.000Z",
        first_seen_at: "2026-07-22T17:00:00.000Z",
        last_seen_at: "2026-07-22T17:00:00.000Z",
        seen_count: 1,
      }],
      rejectedCandidates: [],
      observations: [],
      observationPatch: { version: "1.14.00", publishedAt: null },
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: healthyScoreboard,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    }));

    expect(markup).toContain("Steam review leads share one provider URL");
    expect(markup).not.toContain('name="target_kind" value="signal"');
    expect(markup).not.toContain("Remove bad lead");
  });

  it("gives each public context item one explicit action and hidden items an undo", () => {
    const baseObservation = {
      kind: "community_ask" as const,
      url: "https://www.reddit.com/r/CrimsonDesert/comments/ask/",
      source_domain: "reddit.com",
      snippet: "A recurring customization request.",
      created_at: "2026-07-22T17:00:00.000Z",
      observed_at: "2026-07-22T17:00:00.000Z",
      seen_count: 2,
    };
    const markup = renderToStaticMarkup(createElement(AdminScannerView, {
      runs: [],
      signals: [],
      rejectedCandidates: [],
      observations: [
        {
          ...baseObservation,
          id: "observation-public-undated",
          title: "Undated ask visible only to the operator",
          source_published_at: null,
          is_public: true,
          decision_id: null,
        },
        {
          ...baseObservation,
          id: "observation-hidden",
          title: "Hidden ask with an active decision",
          source_published_at: "2026-07-22T12:00:00.000Z",
          is_public: false,
          decision_id: "decision-1",
        },
      ],
      observationPatch: { version: "1.14.00", publishedAt: null },
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: healthyScoreboard,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    }));

    expect(markup).toContain("Scanner context archive");
    expect(markup).toContain("These search records no longer supply homepage articles.");
    expect(markup).toContain("RETAINED");
    expect(markup).toContain("HIDDEN");
    expect(markup).toContain("Reject and teach…");
    expect(markup).toContain("no usable public lane date");
    expect(markup).toContain("Undo — restore item and revoke rule");
    expect(markup).toContain('name="decision_id" value="decision-1"');
    // The hidden item never re-offers a second reject.
    expect(markup.split("Reject and teach…")).toHaveLength(2);
  });

  it("hides scanner-learning actions until the feedback schema is available", () => {
    const markup = renderToStaticMarkup(createElement(AdminScannerView, {
      runs: [],
      signals: [{
        id: "signal-web-lead",
        cluster_id: "cluster-performance",
        source: "web_search",
        source_url: "https://example.com/lead",
        title: "Retained lead",
        summary: "A retained source that could otherwise be removed.",
        category: "performance",
        confidence: "medium" as const,
        observed_at: "2026-07-22T17:00:00.000Z",
        public_status: "private" as const,
        source_type: "web_search",
        source_domain: "example.com",
        source_published_at: null,
        first_seen_at: "2026-07-22T17:00:00.000Z",
        last_seen_at: "2026-07-22T17:00:00.000Z",
        seen_count: 1,
      }],
      rejectedCandidates: [{
        id: "candidate-one",
        run_id: null,
        title: "Rejected candidate",
        url: "https://example.com/candidate",
        source_domain: "example.com",
        source_published_at: null,
        snippet: "A candidate waiting for optional review.",
        reason: "off_topic",
        created_at: "2026-07-22T17:00:00.000Z",
        expires_at: "2026-07-23T17:00:00.000Z",
        rescued_at: null,
        decision_id: null,
        feedback_rule_id: null,
      }],
      observations: [],
      observationPatch: { version: "1.14.00", publishedAt: null },
      observationModerationAvailable: false,
      feedbackRules: [],
      feedbackLearningAvailable: false,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: healthyScoreboard,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    }));

    expect(markup).toContain("Scanner learning unlocks after the database schema update");
    expect(markup).toContain("Keep as relevant");
    expect(markup).not.toContain('class="decision-card__reject"');
    expect(markup).not.toContain("Remove bad lead");
    expect(markup).not.toContain("Remove lead and teach scanner");
  });

  describe("scanner health honesty", () => {
    const patch = { version: "1.14.00", publishedAt: null };
    const connectedScoreboard = {
      reviewedThisWeek: 0,
      filteredThisWeek: 0,
      keptThisWeek: 0,
      awaiting: 0,
      published: 0,
      lastCheckedAt: null,
      scannerActive: true,
      scannerConnected: true,
      llmPaused: false,
      readFailures: [],
      steamPulse: [],
      platformContext: null,
      pulseReadFailures: [],
    };

    function render(overrides: {
      radarConnected: boolean;
      readFailures?: ScannerReadRegister[];
      weekReviewed?: number;
      integrations?: IntegrationStatus[];
      failedRuns7d?: number;
      llmPaused?: boolean | null;
      pulseReadFailures?: PublicScannerData["pulseReadFailures"];
      platformContext?: PublicScannerData["platformContext"];
      steamPulse?: PublicScannerData["steamPulse"];
    }) {
      const radar = emptyPatchRadarData(patch);
      return renderToStaticMarkup(createElement(AdminScannerView, {
        runs: [],
        signals: [],
        rejectedCandidates: [],
        observations: [],
        observationPatch: { version: "1.14.00", publishedAt: null },
        observationModerationAvailable: true,
        feedbackRules: [],
        feedbackLearningAvailable: true,
        control: {
          paused: false,
          minIntervalMinutes: 60,
          scheduledSearchCreditsPerRun: 1,
          monthlyTavilyCreditCap: 1000,
          monthlyLlmUsdCap: 2,
          modelPreset: "gpt_5_6_luna",
          updatedAt: null,
        },
        activeRun: null,
        latestRealRun: null,
        latestFind: null,
        scoreboard: {
          ...connectedScoreboard,
          llmPaused: overrides.llmPaused === undefined ? false : overrides.llmPaused,
          scannerConnected: (overrides.readFailures ?? []).length === 0,
          readFailures: overrides.readFailures ?? [],
          pulseReadFailures: overrides.pulseReadFailures ?? [],
          platformContext: overrides.platformContext ?? null,
          steamPulse: overrides.steamPulse ?? [],
        },
        radar: {
          ...radar,
          connected: overrides.radarConnected,
          funnel7d: { ...radar.funnel7d, reviewed: overrides.weekReviewed ?? 0 },
          health: {
            ...radar.health,
            runs7d: { ...radar.health.runs7d, failed: overrides.failedRuns7d ?? 0 },
          },
        },
        integrations: overrides.integrations ?? [],
        nowIso: "2026-07-22T18:00:00.000Z",
      }));
    }

    it("names an empty verified health list only when both health reads succeeded", () => {
      const markup = render({ radarConnected: true });

      expect(markup).toContain("No named health checks require action.");
    });

    it("cannot claim the operator is clear when the radar run read failed", () => {
      const markup = render({ radarConnected: false });

      expect(markup).not.toContain("No named health checks require action.");
      expect(markup).toContain("Scanner health unavailable");
      // The band is replaced, not dropped: a missing band reads as a quiet radar.
      expect(markup).toContain("Source radar unavailable");
      expect(markup).toContain("Failed runs unavailable");
      expect(markup).toContain("A required health read is unavailable.");
    });

    it("names a failed register in health and marks only its funnel cell unavailable", () => {
      const markup = render({ radarConnected: true, readFailures: ["published"] });

      expect(markup).not.toContain("No named health checks require action.");
      expect(markup).toContain("A required health read is unavailable.");
      expect(markup).toContain("Published issue total unavailable");
      expect(markup).toContain('<div class="stat-band__value stat-band__value--amber">Unavailable</div>');
      expect(markup).toContain("Automated screening events · 7d");
      expect(markup).not.toContain("The weekly read failed");
    });

    it("does not declare all clear when a collection read fails", () => {
      const markup = render({ radarConnected: true, pulseReadFailures: ["steam"] });
      expect(markup).not.toContain("No named health checks require action.");
      expect(markup).toContain("A required health read is unavailable.");
      expect(markup).toContain("Unknown");
    });

    it("surfaces a failed Twitch collection even when scanner runs succeeded", () => {
      vi.stubEnv("STEAM_PULSE_ENABLED", "true");
      vi.stubEnv("TWITCH_CLIENT_ID", "fixture-client");
      vi.stubEnv("TWITCH_CLIENT_SECRET", "fixture-secret");
      try {
        const markup = render({
          radarConnected: true,
          steamPulse: [{ snapshotDay: "2026-07-22", collectedAt: "2026-07-22T14:00:00Z", totalReviews: 100, positivePercentage: 80, reviewCountDelta: 1, reviewsScanned: 1, issueLanguageCount: 0, leadsRetained: 0 }],
          platformContext: { capturedAt: "2026-07-22T17:00:00Z", igdbStatus: "ok", twitchStatus: "error", twitchComplete: null, releaseAt: null, platforms: [], igdbUrl: null, liveStreams: null, liveViewers: null, twitchHistory: [{ capturedAt: "2026-07-22T16:00:00Z", liveStreams: 10, liveViewers: 100 }] },
        });
        expect(markup).not.toContain("No named health checks require action.");
        expect(markup).toContain("1 named health check needs attention.");
        expect(markup).toContain("Twitch audience: Provider unavailable");
        expect(markup).toContain("Steam reviews");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("cannot claim the operator is clear while the cost circuit is unreadable", () => {
      // Only the circuit query failed, so the scoreboard is legitimately
      // connected — but the engine fails closed on that same failure and stops
      // using LLM extraction. Saying "nothing requires intervention" here would
      // contradict both the status line and what the scanner is doing.
      const markup = render({
        radarConnected: true,
        integrations: [
          {
            key: "ai_extraction",
            label: "AI extraction",
            connected: true,
            missingEnv: [],
            detail: "The cost-safety circuit read failed.",
            circuitUnknown: true,
          },
        ],
        llmPaused: null,
      });

      expect(markup).not.toContain("No named health checks require action.");
      expect(markup).toContain("AI cost-safety state unavailable");
      expect(markup).toContain("A required health read is unavailable.");
    });

    it("keeps the funnel bar and marks only the unread KPI beside it", () => {
      // A connected radar reports a busy week from its own read; the KPI column
      // beside the bar is scoreboard-sourced, so one failed register must cost
      // one KPI rather than the whole row.
      const markup = render({ radarConnected: true, readFailures: ["awaiting"], weekReviewed: 12 });

      expect(markup).toContain("12 automated screening events");
      expect(markup).toContain("Retained-lead share · 7d");
      expect(markup).toContain('<span class="mono-label">unavailable</span>');
      expect(markup).not.toContain('class="desk-funnel__num desk-funnel__num--blue"');
    });

    it("says what the attention count is made of instead of repeating its neighbour", () => {
      // With no provider paused this total equals the Failed runs cell two
      // columns over. An unexplained duplicate reads as a second problem.
      const markup = render({ radarConnected: true, failedRuns7d: 1 });

      expect(markup).toContain("1 failed run in 7 days");
      expect(markup).not.toContain("Run or provider health needs a look");
      expect(markup).toContain("1 named health check needs attention.");
    });

    it("counts a paused provider alongside failed runs in the same caption", () => {
      const markup = render({
        radarConnected: true,
        failedRuns7d: 2,
        integrations: [
          {
            key: "ai_extraction",
            label: "AI extraction",
            connected: true,
            missingEnv: [],
            detail: "The cost-safety circuit is open.",
            paused: true,
          },
        ],
        llmPaused: true,
      });

      expect(markup).toContain("2 failed runs in 7 days");
      expect(markup).toContain("AI cost safety paused");
      expect(markup).toContain("2 named health checks need attention.");
    });

    it("still says nothing is required when both parts are zero", () => {
      const markup = render({ radarConnected: true, failedRuns7d: 0 });

      expect(markup).toContain("No named health checks require action.");
    });
  });

  describe("honest read windows", () => {
    function run(index: number): AutomationRunRow {
      return {
        id: `run-${index}`,
        started_at: `2026-07-2${index % 10}T12:00:00.000Z`,
        finished_at: `2026-07-2${index % 10}T12:01:00.000Z`,
        status: "success",
        mode: "scheduled",
        estimated_cost_usd: 0,
        search_queries_used: 1,
        llm_calls_used: 0,
        signals_inserted: 0,
        signals_deduped: 0,
        clusters_promoted: 0,
        intent: "broad_sweep",
        search_results_seen: 0,
        reddit_posts_seen: 0,
        signals_reobserved: 0,
        stale_signals_hidden: 0,
        candidates_rescued: 0,
        skips: [],
        errors: [],
        funnel: null,
      };
    }

    function renderWithRuns(runs: AutomationRunRow[], latestRealRun = runs[0] ?? null, minIntervalMinutes: 60 | 1440 = 60) {
      return renderToStaticMarkup(createElement(AdminScannerView, {
        runs,
        signals: [],
        rejectedCandidates: [],
        observations: [],
        observationPatch: { version: "1.14.00", publishedAt: null },
        observationModerationAvailable: true,
        feedbackRules: [],
        feedbackLearningAvailable: true,
        control: {
          paused: false,
          minIntervalMinutes,
          scheduledSearchCreditsPerRun: 1,
          monthlyTavilyCreditCap: 1000,
          monthlyLlmUsdCap: 2,
          modelPreset: "gpt_5_6_luna",
          updatedAt: null,
        },
        activeRun: null,
        latestRealRun,
        latestFind: null,
        scoreboard: healthyScoreboard,
        radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
        integrations: [],
        nowIso: "2026-07-22T18:00:00.000Z",
      }));
    }

    it.each(["scheduled", "manual"] as const)("keeps the next attempt accurate when ten skips hide the last %s scan", (mode) => {
      const realRun = { ...run(0), mode, started_at: "2026-07-22T06:00:00.000Z", finished_at: "2026-07-22T06:02:00.000Z" };
      const skips = Array.from({ length: 10 }, (_, index) => ({ ...run(index), status: "skipped" as const, skips: ["recent_run"], started_at: new Date(Date.parse("2026-07-22T18:00:00.000Z") - (index + 1) * 3_600_000).toISOString() }));
      const markup = renderWithRuns(skips, realRun, 1440);
      expect(markup).toContain("Next eligible attempt: in 12h · Jul 23, 2026, 2:00:00 AM EDT");
      expect(markup.match(/class="op-history-row"/g)).toHaveLength(10);
    });

    it("uses the completion instant for the latest-completed-run labels", () => {
      const realRun = { ...run(0), started_at: "2026-07-22T17:30:00.000Z", finished_at: "2026-07-22T17:32:00.000Z" };
      expect(renderWithRuns([realRun])).toContain("Latest completed run: 28m ago · Jul 22, 2026, 1:32:00 PM EDT");
    });

    it("keeps a completed cap visible when ten newer attempts only record recent-run skips", () => {
      const realRun = { ...run(0), skips: ["tavily_credit_cap"] };
      const skips = Array.from({ length: 10 }, (_, index) => ({ ...run(index + 1), status: "skipped" as const, skips: ["recent_run"] }));
      expect(renderWithRuns(skips, realRun)).toContain(">CAPPED</span>");
    });

    it("renders every run the read returned, not a shorter slice of it", () => {
      // The query asks for the newest 10; rendering 8 dropped two reads on the
      // floor and the page said nothing about it.
      const runs = Array.from({ length: 10 }, (_, index) => run(index));
      const markup = renderWithRuns(runs);

      expect(markup.match(/class="op-history-row"/g)).toHaveLength(10);
      // The raw-code disclosure was sliced to 8 too, so it lost the same two.
      // Health summary also prints Eastern times; this count is the disclosure.
      const rawDiagnostics = markup.slice(markup.indexOf("Raw funnel"));
      expect(rawDiagnostics.match(/Jul \d+, 2026, /g)).toHaveLength(10);
      expect(markup).toContain("Scan history and diagnostics · newest 10");
    });

    it("names the window it actually holds when fewer runs exist", () => {
      const markup = renderWithRuns([run(0), run(1), run(2)]);

      expect(markup).toContain("Scan history and diagnostics · newest 3");
      // No invented denominator: there is no total behind this read.
      expect(markup).not.toMatch(/newest 3 of \d/);
    });
  });

  describe("sections that are records, not work", () => {
    function feedbackRule(index: number, scopeValue: string, action: "allow" | "block" = "block") {
      return {
        id: `rule-${index}`,
        decision_id: `decision-${index}`,
        action,
        decision: action === "allow" ? ("relevant" as const) : ("off_topic" as const),
        scope_type: "exact_url" as const,
        scope_value: scopeValue,
        reason: "Reviewed source: not a bug report.",
        created_at: "2026-07-22T12:00:00.000Z",
        expires_at: null,
      };
    }

    function observation(index: number, sourcePublishedAt: string | null, isPublic = true): AdminObservationRow {
      return {
        id: `observation-${index}`,
        kind: "community_ask" as const,
        title: `Observation ${index}`,
        url: `https://reddit.com/r/CrimsonDesert/comments/obs-${index}`,
        source_domain: "reddit.com",
        snippet: "Players asking for something.",
        source_published_at: sourcePublishedAt,
        created_at: "2026-07-21T12:00:00.000Z",
        observed_at: "2026-07-22T12:00:00.000Z",
        seen_count: 1,
        is_public: isPublic,
        decision_id: null,
      };
    }

    function render(overrides: {
      feedbackRules?: ReturnType<typeof feedbackRule>[];
      observations?: ReturnType<typeof observation>[];
      patchPublishedAt?: string | null;
      patchVersion?: string;
      /** The radar's separately cached copy, which can lag the observation read. */
      radarPatch?: { version: string; publishedAt: string | null };
    }) {
      const observationPatch = {
        version: overrides.patchVersion ?? "1.14.00",
        publishedAt: overrides.patchPublishedAt ?? null,
      };
      return renderToStaticMarkup(createElement(AdminScannerView, {
        runs: [],
        signals: [],
        rejectedCandidates: [],
        observations: overrides.observations ?? [],
        observationPatch,
        observationModerationAvailable: true,
        feedbackRules: overrides.feedbackRules ?? [],
        feedbackLearningAvailable: true,
        control: {
          paused: false,
          minIntervalMinutes: 60,
          scheduledSearchCreditsPerRun: 1,
          monthlyTavilyCreditCap: 1000,
          monthlyLlmUsdCap: 2,
          modelPreset: "gpt_5_6_luna",
          updatedAt: null,
        },
        activeRun: null,
        latestRealRun: null,
        latestFind: null,
        scoreboard: healthyScoreboard,
        radar: emptyPatchRadarData(overrides.radarPatch ?? observationPatch),
        integrations: [],
        nowIso: "2026-07-22T18:00:00.000Z",
      }));
    }

    it("gives every grouped rule its own Undo, so grouping never costs a recovery path", () => {
      // Six rules, one domain, one group heading — but six decision ids, six
      // Undo buttons. Grouping is a heading, never a merge.
      const rules = Array.from({ length: 6 }, (_, index) =>
        feedbackRule(index, `https://steamcommunity.com/app/3321460/discussions/0/8057?l=lang${index}`),
      );

      const markup = render({ feedbackRules: rules });

      expect(markup.match(/name="decision_id"/g)).toHaveLength(6);
      expect(markup.match(/>Undo</g)).toHaveLength(6);
      for (const rule of rules) {
        expect(markup).toContain(rule.scope_value);
      }
      // One group row stands in front of all six.
      expect(markup.match(/class="feedback-group"/g)).toHaveLength(1);
      expect(markup).toContain("steamcommunity.com");
    });

    it("states the ledger total rather than making the rows be the count", () => {
      const markup = render({
        feedbackRules: [
          feedbackRule(1, "https://reddit.com/a"),
          feedbackRule(2, "https://adobe.com/b"),
          feedbackRule(3, "https://reddit.com/c", "allow"),
        ],
      });

      expect(markup).toContain("active rules");
      expect(markup).toContain("2 block");
      expect(markup).toContain("1 keep");
      expect(markup).toContain("2 domains");
    });

    it("states the legacy eligibility count once for the archive", () => {
      const markup = render({ observations: [observation(1, null), observation(2, null), observation(3, null)] });

      expect(markup).toContain("Scanner context archive");
      expect(markup).toContain("newest 3 this patch");
      expect(markup).toContain("· 0 eligible under legacy rules");
      expect(markup).toContain("no longer supply homepage articles");
    });

    it("counts historically eligible records when some carry a date", () => {
      const markup = render({
        observations: [observation(1, "2026-07-20T00:00:00.000Z"), observation(2, null)],
      });

      expect(markup).toContain("newest 2 this patch");
      expect(markup).toContain("· 1 eligible under legacy rules");
    });

    it("counts and labels a legacy-eligible undated ask", () => {
      const markup = render({
        patchPublishedAt: "2026-07-20T00:00:00.000Z",
        observations: [observation(1, null)],
      });

      expect(markup).toContain("· 1 eligible under legacy rules");
      expect(markup).toContain("first seen by radar Jul 21");
      expect(markup).toContain("no longer supply homepage articles");
    });

    it("applies historic date and patch gates to the legacy count", () => {
      // The archive keeps the prior eligibility calculation as a diagnostic. A
      // date before the patch era or implausibly far in the future stays out of
      // that count.
      const markup = render({
        patchPublishedAt: "2026-07-20T00:00:00.000Z",
        observations: [
          observation(1, "2026-07-01T00:00:00.000Z"), // before the patch era
          observation(2, "2026-09-01T00:00:00.000Z"), // implausibly far ahead
          observation(3, "2026-07-21T00:00:00.000Z"), // the only real one
        ],
      });

      expect(markup).toContain("newest 3 this patch");
      expect(markup).toContain("· 1 eligible under legacy rules");
    });

    it("stops counting an archived item the operator just hid", () => {
      // Rejecting a lane item sets is_public false and leaves the card in this
      // list. The historic eligibility count must exclude that archived record.
      const markup = render({
        patchPublishedAt: "2026-07-20T00:00:00.000Z",
        observations: [
          observation(1, "2026-07-21T00:00:00.000Z"),
          observation(2, "2026-07-21T00:00:00.000Z", false),
        ],
      });

      expect(markup).toContain("newest 2 this patch");
      expect(markup).toContain("· 1 eligible under legacy rules");
    });

    it("judges legacy eligibility against the patch read, not the cached radar copy", () => {
      // The radar is cached for five minutes; the observation read is not. For
      // that window after a rollover they disagree, and judging fresh 1.15.00
      // coverage by the stale 1.14.00 version calls the new patch off-topic.
      const covers1150 = {
        ...observation(1, "2026-07-21T00:00:00.000Z"),
        kind: "patch_release" as const,
        title: "Crimson Desert 1.15.00 patch notes are live",
        snippet: "Everything that changed in Crimson Desert 1.15.00.",
      };

      const markup = render({
        patchVersion: "1.15.00",
        patchPublishedAt: "2026-07-20T00:00:00.000Z",
        radarPatch: { version: "1.14.00", publishedAt: "2026-06-01T00:00:00.000Z" },
        observations: [covers1150],
      });

      expect(markup).toContain("newest 1 this patch");
      expect(markup).toContain("· 1 eligible under legacy rules");
    });

    it("presents the capped observation read as a window, never as the patch total", () => {
      // The read stops at 40. On a busy patch all three figures in this summary
      // describe that slice, so the label has to say so — "40 this patch" would
      // deny the existence of everything older.
      const markup = render({
        patchPublishedAt: "2026-07-20T00:00:00.000Z",
        observations: Array.from({ length: 40 }, (_, index) =>
          observation(index + 1, "2026-07-21T00:00:00.000Z"),
        ),
      });

      expect(markup).toContain("newest 40 this patch");
      expect(markup).toContain("· 40 eligible under legacy rules");
    });

    it("collapses the record sections and keeps their contents reachable", () => {
      const markup = render({ observations: [observation(1, null)] });

      // Both record sections are disclosures now, not always-open walls.
      expect(markup.match(/class="operator-section"/g)).toHaveLength(2);
      // Nothing is removed: the card is still rendered inside the closed section.
      expect(markup).toContain("Observation 1");
      // And every section is reachable without scrolling the page.
      expect(markup).toContain('href="#lessons"');
      expect(markup).toContain('href="#lanes"');
      expect(markup).toContain('href="#teach"');
    });
  });
});
