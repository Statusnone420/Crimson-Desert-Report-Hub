import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

import { isIntakeRun } from "@/lib/telemetry.server";

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
});
