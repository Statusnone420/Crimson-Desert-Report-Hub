import { describe, expect, it } from "vitest";
import { EMPTY_CLUSTER_CONFIRMATIONS, type ClusterConfirmations } from "@/lib/confirmations";
import { composeIssueReadout, DISPLAY_THRESHOLD_NETWORKS, playerPostsSentence, type IssueReadoutInput } from "@/lib/readout";

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
    expect(fixed.tone).toBe("amber");
  });

  it("post-claim evidence forces Still happening", () => {
    const readout = composeIssueReadout(
      base({ fixClaimedAt: "2026-07-08T00:00:00Z", postClaimEvidenceCount: 1 }),
    );
    expect(readout.state).toBe("still_happening");
    expect(readout.tone).toBe("crimson");
    expect(readout.sentence).toContain("1 exact-patch player report appeared after the claim");
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
    expect(readout.sentence).toContain("The fix claim for 1.13.01 remains unverified.");
    expect(readout.sentence).not.toContain("linked to this issue");
    expect(readout.sentence).not.toContain("fixed this");
    expect(readout.ask?.question).toBe("How is it after 1.13.01?");
    expect(readout.ask?.kinds).toEqual(["fixed_for_me", "still_happening"]);
  });

  it("does not open a dead poll for a legacy claim status without a claim date", () => {
    const readout = composeIssueReadout(base({ storedFixStatus: "verified_fixed" }));
    expect(readout.state).toBe("watching");
    expect(readout.poll).toBeNull();
  });

  it("keeps earlier reports separate from the scanner's posts", () => {
    const readout = composeIssueReadout(base({ directReportCount: 2, publicSignalCount: 3 }));
    expect(readout.state).toBe("confirmed");
    expect(readout.label).toBe("Earlier player reports");
    expect(readout.tone).toBe("crimson");
    expect(readout.sentence).toBe("2 earlier player reports. Personal experiences, not a measure of all players.");
    expect(readout.ask).toBeNull();
  });

  it("labels a single report as earlier history", () => {
    const readout = composeIssueReadout(base({ directReportCount: 1 }));
    expect(readout.state).toBe("confirmed");
    expect(readout.label).toBe("Earlier player reports");
    expect(readout.sentence).toContain("1 earlier player report.");
    expect(readout.ask).toBeNull();
  });

  it("gives earlier general check-ins no weight: they neither confirm nor appear", () => {
    const readout = composeIssueReadout(base({
      confirmations: confirmations({
        totalCount: 5,
        affectedCount: 4,
        affectedNetworks: 3,
        byKind: { ...EMPTY_CLUSTER_CONFIRMATIONS.byKind, have_it: { count: 4, networks: 3 }, not_happening: { count: 1, networks: 1 } },
      }),
    }));
    expect(readout.state).toBe("watching");
    expect(readout.label).toBe("Open");
    expect(readout.sentence).toBe("The scanner keeps checking public sources on this patch.");
  });

  it("labels the scanner's posts the same way on published issues and the watchlist", () => {
    const published = composeIssueReadout(base({ publicSignalCount: 3 }));
    expect(published.state).toBe("public_sources");
    expect(published.tone).toBe("amber");
    expect(published.sentence).toBe("Seen in 3 player posts. Not confirmed by Pearl Abyss.");
    expect(published.ask).toBeNull();

    const watched = composeIssueReadout(base({ candidateSignalCount: 1 }));
    expect(watched.state).toBe("radar_lead");
    expect(watched.tone).toBe("blue");
    expect(watched.sentence).toBe("Seen in 1 player post. Not confirmed by Pearl Abyss.");
    expect(playerPostsSentence(2)).toBe("Seen in 2 player posts. Not confirmed by Pearl Abyss.");
  });

  it("never adds a check-in count to the scanner's posts", () => {
    const readout = composeIssueReadout(
      base({ publicSignalCount: 1, confirmations: confirmations({ affectedCount: 1, affectedNetworks: 1 }) }),
    );
    expect(readout.state).toBe("public_sources");
    expect(readout.sentence).not.toMatch(/check-in/i);
  });

  it("a quiet issue reads from the scanner, never from visitors", () => {
    const readout = composeIssueReadout(base());
    expect(readout.state).toBe("watching");
    expect(readout.tone).toBe("dim");
    expect(readout.sentence).toBe("The scanner keeps checking public sources on this patch.");
    expect(readout.ask).toBeNull();
    expect(readout.poll).toBeNull();
  });

  it("an unread check-in table changes nothing without a fix claim", () => {
    const readout = composeIssueReadout(base({ checkinsAvailable: false, publicSignalCount: 2 }));
    expect(readout.state).toBe("public_sources");
    expect(readout.hasCurrentClaim).toBe(false);
    expect(readout.sentence).toBe("Seen in 2 player posts. Not confirmed by Pearl Abyss.");
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

  it("an unread check-in table is not zero responses or a quiet fix verdict", () => {
    const readout = composeIssueReadout(base({ checkinsAvailable: false, fixClaimedAt: "2026-07-08T00:00:00Z" }));
    expect(readout.label).toBe("Check-ins unavailable");
    expect(readout.hasCurrentClaim).toBe(true);
    expect(readout.ask).toBeNull();
    expect(readout.poll).toBeNull();
    expect(readout.sentence).not.toMatch(/quiet|no community check-ins|0 responses/i);
  });
});
