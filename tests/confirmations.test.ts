import { describe, expect, it } from "vitest";
import { CONFIRMATION_KINDS, computeClusterConfirmations, type ConfirmationRow } from "@/lib/confirmations";

const row = (over: Partial<ConfirmationRow>): ConfirmationRow => ({
  cluster_id: "c1",
  platform: "pc_steam",
  kind: "have_it",
  voter_ip_hash: "hash-a",
  created_at: "2026-07-09T12:00:00Z",
  ...over,
});

describe("computeClusterConfirmations", () => {
  it("exposes the four personal responses", () => {
    expect(CONFIRMATION_KINDS).toEqual(["have_it", "not_happening", "still_happening", "fixed_for_me"]);
  });

  it("never treats not-happening responses as affected or a fix verdict", () => {
    const tallies = computeClusterConfirmations([
      row({ kind: "not_happening" }),
      row({ kind: "have_it", voter_ip_hash: "other-network" }),
    ], "2026-07-08T00:00:00Z");
    expect(tallies.totalCount).toBe(2);
    expect(tallies.byKind.not_happening.count).toBe(1);
    expect(tallies.byPlatform.pc_steam.count).toBe(2);
    expect(tallies.affectedCount).toBe(1);
    expect(tallies.pollFixedCount).toBe(0);
    expect(tallies.pollStillCount).toBe(0);
    expect(JSON.stringify(tallies)).not.toContain("other-network");
  });

  it("counts affected = have_it + still_happening, with distinct networks", () => {
    const tallies = computeClusterConfirmations(
      [
        row({}),
        row({ voter_ip_hash: "hash-b", kind: "still_happening" }),
        row({ voter_ip_hash: "hash-b", kind: "still_happening" }),
      ],
      null,
    );
    expect(tallies.affectedCount).toBe(3);
    expect(tallies.affectedNetworks).toBe(2);
    expect(tallies.pollFixedCount).toBe(0);
    expect(tallies.pollStillCount).toBe(0); // no claim date → no poll
  });

  it("fixed_for_me does not count as affected", () => {
    const tallies = computeClusterConfirmations([row({ kind: "fixed_for_me" })], null);
    expect(tallies.affectedCount).toBe(0);
    expect(tallies.affectedNetworks).toBe(0);
  });

  it("poll counts only votes at/after fix_claimed_at", () => {
    const tallies = computeClusterConfirmations(
      [
        row({ kind: "still_happening", created_at: "2026-07-01T00:00:00Z" }), // pre-claim: affected, not poll
        row({ voter_ip_hash: "hash-b", kind: "still_happening", created_at: "2026-07-09T00:00:00Z" }),
        row({ voter_ip_hash: "hash-c", kind: "fixed_for_me", created_at: "2026-07-09T01:00:00Z" }),
      ],
      "2026-07-08T00:00:00Z",
    );
    expect(tallies.pollStillCount).toBe(1);
    expect(tallies.pollStillNetworks).toBe(1);
    expect(tallies.pollFixedCount).toBe(1);
    expect(tallies.pollFixedNetworks).toBe(1);
    expect(tallies.affectedCount).toBe(2); // both still_happening rows regardless of the clock
  });

  it("rolls up every stance by platform because platform is required for each tap", () => {
    const tallies = computeClusterConfirmations(
      [
        row({}),
        row({ voter_ip_hash: "hash-b", platform: "ps5", kind: "still_happening" }),
        row({ voter_ip_hash: "hash-c", platform: "ps5", kind: "fixed_for_me" }),
      ],
      null,
    );
    expect(tallies.byPlatform.pc_steam).toEqual({ count: 1, networks: 1, byKind: { have_it: 1 } });
    expect(tallies.byPlatform.ps5).toEqual({ count: 2, networks: 2, byKind: { still_happening: 1, fixed_for_me: 1 } });
    expect(tallies.byPlatform.xbox_series_x).toBeUndefined();
  });

  it("keeps exact raw totals per stance instead of folding every affected tap into have-it", () => {
    const tallies = computeClusterConfirmations(
      [
        row({ kind: "have_it" }),
        row({ voter_ip_hash: "hash-b", kind: "still_happening" }),
        row({ voter_ip_hash: "hash-c", kind: "fixed_for_me" }),
      ],
      "2026-07-08T00:00:00Z",
    );

    expect(tallies.totalCount).toBe(3);
    expect(tallies.byKind).toEqual({
      have_it: { count: 1, networks: 1 },
      not_happening: { count: 0, networks: 0 },
      still_happening: { count: 1, networks: 1 },
      fixed_for_me: { count: 1, networks: 1 },
    });
  });

  it("ignores rows with an invalid timestamp for the poll but keeps them as affected", () => {
    const tallies = computeClusterConfirmations(
      [row({ kind: "still_happening", created_at: "not-a-date" })],
      "2026-07-08T00:00:00Z",
    );
    expect(tallies.affectedCount).toBe(1);
    expect(tallies.pollStillCount).toBe(0);
  });
});
