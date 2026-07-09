import { describe, expect, it } from "vitest";
import { EMPTY_CLUSTER_CONFIRMATIONS, type ClusterConfirmations } from "@/lib/confirmations";
import { composeIssueReadout, DISPLAY_THRESHOLD_NETWORKS, type IssueReadoutInput } from "@/lib/readout";

function confirmations(over: Partial<ClusterConfirmations> = {}): ClusterConfirmations {
  return { ...EMPTY_CLUSTER_CONFIRMATIONS, byPlatform: {}, ...over };
}

function base(over: Partial<IssueReadoutInput> = {}): IssueReadoutInput {
  return {
    directReportCount: 0,
    publicSignalCount: 0,
    candidateSignalCount: 0,
    postClaimEvidenceCount: 0,
    confirmations: confirmations(),
    fixClaimedAt: null,
    adminOverride: false,
    storedFixStatus: "reported",
    patchVersion: "1.13.01",
    ...over,
  };
}

describe("composeIssueReadout", () => {
  it("uses 2 distinct networks as the escalation threshold", () => {
    expect(DISPLAY_THRESHOLD_NETWORKS).toBe(2);
  });

  it("locked: shows the maintainer's stored state and says so", () => {
    const still = composeIssueReadout(base({ adminOverride: true, storedFixStatus: "persists" }));
    expect(still.state).toBe("locked");
    expect(still.label).toBe("Still happening");
    expect(still.tone).toBe("crimson");
    expect(still.sentence).toContain("maintainer");

    const fixed = composeIssueReadout(base({ adminOverride: true, storedFixStatus: "verified_fixed" }));
    expect(fixed.label).toBe("Marked fixed by maintainer");
    expect(fixed.tone).toBe("green");
  });

  it("post-claim evidence forces Still happening", () => {
    const readout = composeIssueReadout(
      base({ fixClaimedAt: "2026-07-08T00:00:00Z", postClaimEvidenceCount: 1 }),
    );
    expect(readout.state).toBe("still_happening");
    expect(readout.tone).toBe("crimson");
    expect(readout.poll).not.toBeNull();
  });

  it("poll still-happening at threshold forces Still happening without evidence", () => {
    const readout = composeIssueReadout(
      base({
        fixClaimedAt: "2026-07-08T00:00:00Z",
        confirmations: confirmations({ pollStillCount: 2, pollStillNetworks: 2 }),
      }),
    );
    expect(readout.state).toBe("still_happening");
  });

  it("a single still-happening network does NOT escalate; sentence still carries the count", () => {
    const readout = composeIssueReadout(
      base({
        fixClaimedAt: "2026-07-08T00:00:00Z",
        confirmations: confirmations({ pollStillCount: 1, pollStillNetworks: 1 }),
      }),
    );
    expect(readout.state).toBe("fix_claimed_unverified");
    expect(readout.sentence).toContain("1");
  });

  it("players say fixed when fixed votes clear threshold and beat still votes", () => {
    const readout = composeIssueReadout(
      base({
        fixClaimedAt: "2026-07-08T00:00:00Z",
        confirmations: confirmations({ pollFixedCount: 3, pollFixedNetworks: 3, pollStillCount: 1, pollStillNetworks: 1 }),
      }),
    );
    expect(readout.state).toBe("players_say_fixed");
    expect(readout.tone).toBe("green");
    expect(readout.sentence).toContain("3");
  });

  it("a tie stays Still happening (conservative)", () => {
    const readout = composeIssueReadout(
      base({
        fixClaimedAt: "2026-07-08T00:00:00Z",
        confirmations: confirmations({ pollFixedCount: 2, pollFixedNetworks: 2, pollStillCount: 2, pollStillNetworks: 2 }),
      }),
    );
    expect(readout.state).toBe("still_happening");
  });

  it("claim with zero answers reads as an open question, never green", () => {
    const readout = composeIssueReadout(base({ fixClaimedAt: "2026-07-08T00:00:00Z" }));
    expect(readout.state).toBe("fix_claimed_unverified");
    expect(readout.tone).toBe("amber");
    expect(readout.sentence).toContain("Quiet can mean fixed");
    expect(readout.ask?.kinds).toEqual(["fixed_for_me", "still_happening"]);
  });

  it("legacy verified_fixed without poll data is treated as unverified claim, not green", () => {
    const readout = composeIssueReadout(base({ storedFixStatus: "verified_fixed" }));
    expect(readout.state).toBe("fix_claimed_unverified");
    expect(readout.tone).toBe("amber");
  });

  it("reports make Confirmed by players", () => {
    const readout = composeIssueReadout(base({ directReportCount: 2 }));
    expect(readout.state).toBe("confirmed");
    expect(readout.tone).toBe("crimson");
    expect(readout.sentence).toContain("2");
    expect(readout.ask?.kinds).toEqual(["have_it"]);
  });

  it("escalated confirmations alone make Confirmed by players", () => {
    const readout = composeIssueReadout(
      base({ confirmations: confirmations({ affectedCount: 4, affectedNetworks: 3 }) }),
    );
    expect(readout.state).toBe("confirmed");
  });

  it("a single confirming network does not confirm; falls through to signals", () => {
    const readout = composeIssueReadout(
      base({ publicSignalCount: 1, confirmations: confirmations({ affectedCount: 1, affectedNetworks: 1 }) }),
    );
    expect(readout.state).toBe("public_sources");
    expect(readout.tone).toBe("amber");
  });

  it("candidates only reads as a radar lead that counts for nothing yet", () => {
    const readout = composeIssueReadout(base({ candidateSignalCount: 2 }));
    expect(readout.state).toBe("radar_lead");
    expect(readout.tone).toBe("blue");
    expect(readout.sentence).toContain("counts for nothing until players confirm");
    expect(readout.ask?.kinds).toEqual(["have_it"]);
  });

  it("nothing at all is Watching with no ask", () => {
    const readout = composeIssueReadout(base());
    expect(readout.state).toBe("watching");
    expect(readout.tone).toBe("dim");
    expect(readout.ask).toBeNull();
    expect(readout.poll).toBeNull();
  });

  it("never begs: zero-input sentences avoid crowd language", () => {
    const states = [
      composeIssueReadout(base()),
      composeIssueReadout(base({ candidateSignalCount: 1 })),
      composeIssueReadout(base({ fixClaimedAt: "2026-07-08T00:00:00Z" })),
    ];
    for (const readout of states) {
      expect(readout.sentence).not.toMatch(/waiting on the community|players testing|be the first/i);
    }
  });

  it("poll object is present exactly when a claim context exists", () => {
    expect(composeIssueReadout(base()).poll).toBeNull();
    expect(composeIssueReadout(base({ directReportCount: 1 })).poll).toBeNull();
    const withClaim = composeIssueReadout(
      base({ fixClaimedAt: "2026-07-08T00:00:00Z", confirmations: confirmations({ pollFixedCount: 1, pollFixedNetworks: 1 }) }),
    );
    expect(withClaim.poll).toEqual({ fixedCount: 1, stillCount: 0, escalated: false });
  });
});
