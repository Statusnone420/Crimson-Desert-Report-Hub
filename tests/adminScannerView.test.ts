import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { ScannerFeedbackDesk } from "@/components/scanner/ScannerFeedbackDesk";
import { emptyPatchRadarData } from "@/lib/radar.server";
import type { PublicScannerData } from "@/lib/queries";
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
  it("keeps the owner-approved two-dollar LLM cap inside native form validation", () => {
    const view = AdminScannerView({
      runs: [],
      signals: [],
      rejectedCandidates: [],
      observations: [],
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
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
    expect(input?.props.max).toBe("2");
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
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
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
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
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
      observationModerationAvailable: true,
      feedbackRules: [],
      feedbackLearningAvailable: true,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
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

    expect(markup).toContain("Wire and Asks on the Brief");
    expect(markup).toContain("Reject and teach…");
    expect(markup).toContain("no source date — never shown publicly");
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
      observationModerationAvailable: false,
      feedbackRules: [],
      feedbackLearningAvailable: false,
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
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
    expect(markup).not.toContain("Reject and teach");
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
    }) {
      const radar = emptyPatchRadarData(patch);
      return renderToStaticMarkup(createElement(AdminScannerView, {
        runs: [],
        signals: [],
        rejectedCandidates: [],
        observations: [],
        observationModerationAvailable: true,
        feedbackRules: [],
        feedbackLearningAvailable: true,
        control: {
          paused: false,
          minIntervalMinutes: 60,
          scheduledSearchCreditsPerRun: 1,
          monthlyTavilyCreditCap: 1000,
          monthlyLlmUsdCap: 2,
          modelPreset: "deepseek_v4_flash",
          updatedAt: null,
        },
        activeRun: null,
        latestRealRun: null,
        latestFind: null,
        scoreboard: {
          ...connectedScoreboard,
          scannerConnected: (overrides.readFailures ?? []).length === 0,
          readFailures: overrides.readFailures ?? [],
        },
        radar: {
          ...radar,
          connected: overrides.radarConnected,
          funnel7d: { ...radar.funnel7d, reviewed: overrides.weekReviewed ?? 0 },
        },
        integrations: overrides.integrations ?? [],
        nowIso: "2026-07-22T18:00:00.000Z",
      }));
    }

    it("says nothing requires intervention only when both health reads succeeded", () => {
      const markup = render({ radarConnected: true });

      expect(markup).toContain("Nothing requires intervention.");
    });

    it("cannot claim the operator is clear when the radar run read failed", () => {
      const markup = render({ radarConnected: false });

      expect(markup).not.toContain("Nothing requires intervention.");
      expect(markup).toContain("Scanner health is unavailable");
      // The band is replaced, not dropped: a missing band reads as a quiet radar.
      expect(markup).toContain("Source radar unavailable");
      expect(markup).toContain("Failed runs unavailable");
      expect(markup).not.toContain("No scanner intervention required");
    });

    it("marks only the failed register in the funnel band", () => {
      // Scanner health comes from the radar's run reads and the circuit, not
      // from these counters — so a failed published read greys its own cell and
      // leaves both the headline and its neighbours alone.
      const markup = render({ radarConnected: true, readFailures: ["published"] });

      expect(markup).toContain("Nothing requires intervention.");
      expect(markup).toContain('<div class="stat-band__value stat-band__value--amber">Unavailable</div>');
      expect(markup).toContain("Reviewed · 7d");
      expect(markup).not.toContain("The weekly read failed");
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
      });

      expect(markup).not.toContain("Nothing requires intervention.");
      expect(markup).toContain("AI EXTRACTION STATE UNKNOWN");
      expect(markup).toContain("Scanner health is unavailable");
    });

    it("keeps the funnel bar and marks only the unread KPI beside it", () => {
      // A connected radar reports a busy week from its own read; the KPI column
      // beside the bar is scoreboard-sourced, so one failed register must cost
      // one KPI rather than the whole row.
      const markup = render({ radarConnected: true, readFailures: ["awaiting"], weekReviewed: 12 });

      expect(markup).toContain("12 candidates reviewed");
      expect(markup).toContain("Radar yield");
      expect(markup).toContain('<span class="mono-label">unavailable</span>');
      expect(markup).not.toContain('class="desk-funnel__num desk-funnel__num--blue"');
    });
  });
});
