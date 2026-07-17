import { describe, expect, it } from "vitest";
import { hasClusterEvidence, monitoredAreasNote, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";

describe("hasClusterEvidence", () => {
  it("treats approved player reports as evidence and other signals separately", () => {
    expect(hasClusterEvidence({ directReportCount: 0 })).toBe(false);
    expect(hasClusterEvidence({ directReportCount: 2 })).toBe(true);
  });
});

describe("needsFullIssueCard", () => {
  it("counts a public source-only cluster as a published issue without calling it a player report", () => {
    const base = { strengthScore: 0, directReportCount: 0, confirmations: { totalCount: 0 }, readout: { poll: null } };
    expect(needsFullIssueCard(base)).toBe(false);
    expect(needsFullIssueCard({ ...base, confirmations: { totalCount: 1 } })).toBe(true);
    expect(needsFullIssueCard({ ...base, readout: { poll: { fixedCount: 0, stillCount: 0 } } })).toBe(true);
    // A reviewed source lead contributes to strengthScore while direct reports remain zero.
    expect(needsFullIssueCard({ ...base, strengthScore: 1 })).toBe(true);
  });
});

describe("splitWatchlistByCandidates", () => {
  const watchlist = [
    { id: "a", candidateSignalCount: 0 },
    { id: "b", candidateSignalCount: 1 },
    { id: "c", candidateSignalCount: 2 },
    { id: "d", candidateSignalCount: 0 },
  ];

  it("puts clusters with unconfirmed mentions in candidates", () => {
    const { candidates } = splitWatchlistByCandidates(watchlist);
    expect(candidates.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("puts zero-mention clusters in monitored", () => {
    const { monitored } = splitWatchlistByCandidates(watchlist);
    expect(monitored.map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("partitions completely: candidates + monitored equals the whole watchlist", () => {
    const { candidates, monitored } = splitWatchlistByCandidates(watchlist);
    expect(candidates.length + monitored.length).toBe(watchlist.length);
    const combined = [...candidates, ...monitored].map((c) => c.id).sort();
    expect(combined).toEqual(watchlist.map((c) => c.id).sort());
  });

  it("returns empty partitions for an empty watchlist", () => {
    const { candidates, monitored } = splitWatchlistByCandidates([]);
    expect(candidates).toEqual([]);
    expect(monitored).toEqual([]);
  });
});

describe("monitoredAreasNote", () => {
  it("uses the singular 'area' for one monitored cluster", () => {
    expect(monitoredAreasNote(1)).toBe(
      "Monitoring 1 more known problem area — no player reports or public sources yet.",
    );
  });

  it("uses the plural 'areas' for more than one", () => {
    expect(monitoredAreasNote(2)).toBe(
      "Monitoring 2 more known problem areas — no player reports or public sources yet.",
    );
  });
});
