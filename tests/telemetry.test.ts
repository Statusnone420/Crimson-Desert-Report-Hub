import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

import {
  buildObservatoryDaily,
  isIntakeRun,
  screenedCandidatesForRun,
  screenedOutCandidatesForRun,
} from "@/lib/telemetry.server";

type IntakeRun = Parameters<typeof isIntakeRun>[0];

const baseRun: IntakeRun = {
  started_at: "2026-07-17T12:00:00.000Z",
  status: "success",
  mode: "manual",
  intent: "rescue_candidate",
  search_queries_used: 0,
  search_results_seen: 0,
  reddit_posts_seen: 0,
  signals_inserted: 1,
  signals_reobserved: 0,
  funnel: { candidatesSeen: 1 },
  llm_calls_used: 1,
  estimated_cost_usd: 0.0002,
};

describe("isIntakeRun", () => {
  it("excludes a successful zero-source admin rescue from intake telemetry", () => {
    expect(isIntakeRun(baseRun)).toBe(false);
  });

  it("keeps a normal zero-search rescue-candidate scan that ingested Reddit", () => {
    expect(
      isIntakeRun({
        ...baseRun,
        reddit_posts_seen: 1,
      }),
    ).toBe(true);
  });

  it("excludes a failed zero-source admin rescue even without a successful rescue", () => {
    expect(
      isIntakeRun({
        ...baseRun,
        status: "failed",
        signals_inserted: 0,
        funnel: { candidatesSeen: 1 },
      }),
    ).toBe(false);
  });

  it("keeps a zero-source run without the admin-rescue funnel signature", () => {
    expect(
      isIntakeRun({
        ...baseRun,
        signals_inserted: 0,
        funnel: { candidatesSeen: 0 },
      }),
    ).toBe(true);
  });

  it("counts only candidates that entered screening, not fetched source rows", () => {
    const run = {
      ...baseRun,
      mode: "scheduled",
      intent: "broad_discovery",
      search_results_seen: 8,
      reddit_posts_seen: 12,
      signals_inserted: 1,
      funnel: { candidatesSeen: 5 },
    };

    expect(screenedCandidatesForRun(run)).toBe(5);

    const point = buildObservatoryDaily([run], new Date("2026-07-17T12:00:00.000Z")).find(
      (dailyPoint) => dailyPoint.date === "2026-07-17",
    );
    expect(point).toEqual({ date: "2026-07-17", reviewed: 5, kept: 1, reobserved: 0, llmCalls: 1 });
  });

  it("does not infer screened candidates when the persisted funnel count is missing", () => {
    expect(
      screenedCandidatesForRun({
        ...baseRun,
        search_results_seen: 8,
        reddit_posts_seen: 12,
        funnel: {},
      }),
    ).toBe(0);
  });

  it("does not count within-run duplicates as screened out", () => {
    expect(
      screenedOutCandidatesForRun({
        ...baseRun,
        mode: "scheduled",
        intent: "broad_discovery",
        signals_inserted: 1,
        funnel: { candidatesSeen: 5, deduped: 2 },
      }),
    ).toBe(2);
  });

  it("does not count screened survivors as filtered when persistence fails", () => {
    expect(
      screenedOutCandidatesForRun({
        ...baseRun,
        status: "failed",
        mode: "scheduled",
        intent: "broad_discovery",
        signals_inserted: 0,
        funnel: { candidatesSeen: 5, deduped: 1, kept: 4 },
      }),
    ).toBe(0);
  });

  it("does not count screened survivors as filtered after partial persistence", () => {
    expect(
      screenedOutCandidatesForRun({
        ...baseRun,
        status: "partial",
        mode: "scheduled",
        intent: "broad_discovery",
        signals_inserted: 1,
        funnel: { candidatesSeen: 5, deduped: 1, kept: 4 },
      }),
    ).toBe(0);
  });
});
