import { describe, expect, it } from "vitest";
import {
  countEvidenceBackedPersistentClusters,
  countUnverifiedPersistentWatchlistClusters,
  hasClusterEvidence,
  isUnverifiedWatchlistCluster,
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
    expect(countUnverifiedPersistentWatchlistClusters(clusters)).toBe(1);
  });
});
