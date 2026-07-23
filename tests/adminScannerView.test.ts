import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { ScannerFeedbackDesk } from "@/components/scanner/ScannerFeedbackDesk";
import { emptyPatchRadarData } from "@/lib/radar.server";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/actions", () => ({
  setScannerPolicy: vi.fn(),
  recordScannerDecision: vi.fn(),
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

describe("AdminScannerView", () => {
  it("keeps the owner-approved two-dollar LLM cap inside native form validation", () => {
    const view = AdminScannerView({
      runs: [],
      signals: [],
      rejectedCandidates: [],
      feedbackRules: [],
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
      scoreboard: {} as never,
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
      feedbackRules: [],
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
      scoreboard: {} as never,
      radar: emptyPatchRadarData({ version: "1.14.00", publishedAt: null }),
      integrations: [],
      nowIso: "2026-07-22T18:00:00.000Z",
    }));

    expect(markup).toContain("Retained lead 8");
    expect(markup).toContain("Browse 2 older leads");
    expect(markup.match(/name="target_kind" value="signal"/g)).toHaveLength(8);
    expect(markup.match(/Remove bad lead/g)).toHaveLength(8);
  });
});
