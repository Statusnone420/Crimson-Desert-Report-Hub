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
  candidates_rescued: 1,
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

  it("keeps a rescue-candidate run with no successful rescue", () => {
    expect(
      isIntakeRun({
        ...baseRun,
        candidates_rescued: 0,
        signals_inserted: 0,
      }),
    ).toBe(true);
  });
});
