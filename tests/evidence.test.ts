import { describe, expect, it } from "vitest";
import { displayDescription, hasClusterEvidence, monitoredAreasNote, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";

describe("displayDescription", () => {
  it.each([
    "crashes to desktop/home and launch hangs",
    "frame-rate drops, stutter, and frame-pacing issues",
  ])("dates the original watchlist note for %s without claiming a current regression", (subject) => {
    const description = `Watchlist item for ${subject} after patch 1.13.00. It remains unverified until approved reports or public signals confirm it.`;
    expect(displayDescription("Issue title", description)).toBe(
      `Historical watchlist note (Patch 1.13.00): ${subject}. It remains unverified until approved reports or public signals confirm it.`,
    );
  });

  it("preserves ordinary issue descriptions and removes internal review notes", () => {
    expect(displayDescription("Issue title", " A current issue.  (body retained for 48h moderator review) ")).toBe("A current issue.");
    expect(displayDescription("Issue title", "Players report a crash after patch 2.02.00.")).toBe("Players report a crash after patch 2.02.00.");
    expect(displayDescription("Issue title", " issue   title ")).toBeNull();
    expect(displayDescription("Issue title", null)).toBeNull();
  });
});

describe("hasClusterEvidence", () => {
  it("treats approved player reports as evidence and other signals separately", () => {
    expect(hasClusterEvidence({ directReportCount: 0 })).toBe(false);
    expect(hasClusterEvidence({ directReportCount: 2 })).toBe(true);
  });
});

describe("needsFullIssueCard", () => {
  it("uses affected check-ins, rather than the total of every response, as a publication reason", () => {
    const base = { strengthScore: 0, directReportCount: 0, confirmations: { affectedCount: 0 }, readout: { poll: null } };
    expect(needsFullIssueCard(base)).toBe(false);
    const negativeOnly = { ...base, confirmations: { totalCount: 2, affectedCount: 0 } };
    expect(needsFullIssueCard(negativeOnly)).toBe(false);
    expect(negativeOnly.confirmations.totalCount).toBe(2);
    expect(needsFullIssueCard({ ...base, confirmations: { affectedCount: 1 } })).toBe(true);
    expect(needsFullIssueCard({ ...base, directReportCount: 1 })).toBe(true);
    expect(needsFullIssueCard({ ...base, readout: { poll: { fixedCount: 0, stillCount: 0 } } })).toBe(true);
    // A reviewed source lead contributes to strengthScore while direct reports remain zero.
    expect(needsFullIssueCard({ ...base, strengthScore: 1 })).toBe(true);
  });

  it("keeps historical check-ins readable without treating them as current player evidence", () => {
    const historical = { strengthScore: 0, directReportCount: 0, confirmations: { affectedCount: 0 }, earlierCheckinCount: 2, readout: { poll: null } };
    expect(needsFullIssueCard(historical)).toBe(true);
    expect(hasClusterEvidence(historical)).toBe(false);
    expect(historical.confirmations.affectedCount).toBe(0);
  });

  it("keeps an exact claim published when its check-in tally is unavailable", () => {
    expect(needsFullIssueCard({ strengthScore: 0, directReportCount: 0, confirmations: { affectedCount: 0 }, readout: { poll: null, hasCurrentClaim: true } })).toBe(true);
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
  it("states the remainder's own share of the watchlist, inflected at one", () => {
    expect(monitoredAreasNote(1)).toBe("Monitoring 1 additional watchlist issue.");
    expect(monitoredAreasNote(2)).toBe("Monitoring 2 additional watchlist issues.");
  });

  it("never calls the monitored remainder a problem area, or claims it is known", () => {
    // "Problem areas" is the locked public name for the radar's
    // activeLeadClusters metric — a different population entirely. "Known"
    // overclaimed: these are exactly the clusters with no evidence yet.
    expect(monitoredAreasNote(3)).not.toMatch(/problem area|known/);
  });
});
