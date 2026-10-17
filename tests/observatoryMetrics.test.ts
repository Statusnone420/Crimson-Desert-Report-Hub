import { describe, expect, it } from "vitest";
import { describeScanPlain } from "@/lib/automation/runDisplay";
import { displayCandidateCount } from "@/lib/observatoryMetrics";

describe("displayCandidateCount", () => {
  it("uses the funnel total so Steam-only scans do not look empty", () => {
    expect(
      displayCandidateCount({
        funnel: { candidatesSeen: 3 },
        search_results_seen: 0,
        reddit_posts_seen: 0,
      }),
    ).toBe(3);
  });

  it("treats a real funnel zero as authoritative", () => {
    expect(
      displayCandidateCount({
        funnel: { candidatesSeen: 0 },
        search_results_seen: 8,
        reddit_posts_seen: 2,
      }),
    ).toBe(0);
  });

  it("falls back to historical source counters when no funnel total exists", () => {
    expect(displayCandidateCount({ funnel: {}, search_results_seen: 8, reddit_posts_seen: 2 })).toBe(10);
  });
});

describe("describeScanPlain", () => {
  it("reports Steam-only screened candidates from the funnel", () => {
    expect(
      describeScanPlain({
        funnel: { candidatesSeen: 2 },
        search_results_seen: 0,
        reddit_posts_seen: 0,
        signals_inserted: 1,
        signals_reobserved: 0,
        clusters_promoted: 0,
        skips: [],
      }),
    ).toMatchObject({ found: 2, kept: 1, dropped: 1, held: 1 });
  });
});
