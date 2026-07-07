import { describe, expect, it } from "vitest";
import {
  countEvidenceBackedPersistentClusters,
  countUnverifiedClaimedFixWatchlistClusters,
  hasClusterEvidence,
  isUnverifiedWatchlistCluster,
  monitoredAreasNote,
  splitWatchlistByCandidates,
  unconfirmedMentionsNote,
} from "@/lib/evidence";

const clusters = [
  { confidence: "seed_unverified", fix_status: "persists", strengthScore: 0 },
  { confidence: "seed_unverified", fix_status: "fix_claimed", strengthScore: 0 },
  { confidence: "medium", fix_status: "persists", strengthScore: 2 },
  { confidence: "low", fix_status: "reported", strengthScore: 1 },
];

describe("cluster evidence display rules", () => {
  it("treats zero-strength seeded clusters as watchlist items, not evidence", () => {
    expect(hasClusterEvidence(clusters[0])).toBe(false);
    expect(isUnverifiedWatchlistCluster(clusters[0])).toBe(true);
    expect(hasClusterEvidence(clusters[2])).toBe(true);
    expect(isUnverifiedWatchlistCluster(clusters[2])).toBe(false);
  });

  it("counts persistence only when evidence exists", () => {
    expect(countEvidenceBackedPersistentClusters(clusters)).toBe(1);
    expect(countUnverifiedClaimedFixWatchlistClusters(clusters)).toBe(2);
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

describe("unconfirmedMentionsNote", () => {
  it("uses the singular 'mention' for one", () => {
    expect(unconfirmedMentionsNote(1)).toBe("1 unconfirmed mention — not enough separate sources to back it yet");
  });

  it("uses the plural 'mentions' for more than one", () => {
    expect(unconfirmedMentionsNote(2)).toBe("2 unconfirmed mentions — not enough separate sources to back it yet");
  });
});
