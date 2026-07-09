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
  it("exposes the three kinds", () => {
    expect(CONFIRMATION_KINDS).toEqual(["have_it", "still_happening", "fixed_for_me"]);
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
    expect(tallies.pollStillCount).toBe(0); // no claim clock → no poll
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

  it("rolls up per-platform affected counts and networks", () => {
    const tallies = computeClusterConfirmations(
      [row({}), row({ voter_ip_hash: "hash-b", platform: "ps5", kind: "still_happening" })],
      null,
    );
    expect(tallies.byPlatform.pc_steam).toEqual({ count: 1, networks: 1 });
    expect(tallies.byPlatform.ps5).toEqual({ count: 1, networks: 1 });
    expect(tallies.byPlatform.xbox_series_x).toBeUndefined();
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
