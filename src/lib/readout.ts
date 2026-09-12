import type { ClusterConfirmations, ConfirmationKind } from "@/lib/confirmations";

export type ReadoutState =
  | "locked"
  | "still_happening"
  | "players_say_fixed"
  | "fix_claimed_unverified"
  | "confirmed"
  | "public_sources"
  | "public_sources_unavailable"
  | "radar_lead"
  | "watching";

export type ReadoutTone = "crimson" | "amber" | "green" | "blue" | "dim";

export type IssueReadoutInput = {
  directReportCount: number;
  publicSignalCount: number;
  candidateSignalCount: number;
  postClaimEvidenceCount: number;
  confirmations: ClusterConfirmations;
  fixClaimedAt: string | null;
  adminOverride: boolean;
  storedFixStatus: string;
  patchVersion: string;
  publicSignalsUnavailable?: boolean;
  checkinsAvailable?: boolean;
};

export type IssueReadoutAsk = {
  question: string;
  kinds: ConfirmationKind[];
};

export type IssueReadout = {
  state: ReadoutState;
  /** Claim presence survives an unavailable response tally. */
  hasCurrentClaim?: boolean;
  label: string;
  tone: ReadoutTone;
  sentence: string;
  ask: IssueReadoutAsk | null;
  poll: { fixedCount: number; stillCount: number; escalated: boolean } | null;
};

/** Confirmation-driven labels/meters escalate at this many networks; structured reports are evidence immediately. */
export const DISPLAY_THRESHOLD_NETWORKS = 2;

const LOCKED_META: Record<string, { label: string; tone: ReadoutTone }> = {
  reported: { label: "Open", tone: "dim" },
  acknowledged: { label: "Acknowledged", tone: "amber" },
  fix_claimed: { label: "Fix claimed — unverified", tone: "amber" },
  verified_fixed: { label: "Marked fixed by maintainer", tone: "amber" },
  persists: { label: "Still happening", tone: "crimson" },
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function hasClaimContext(input: IssueReadoutInput): boolean {
  return input.fixClaimedAt !== null;
}

function pollAsk(patchVersion: string): IssueReadoutAsk {
  return { question: `How is it after ${patchVersion}?`, kinds: ["fixed_for_me", "still_happening"] };
}

function haveItAsk(): IssueReadoutAsk {
  return { question: "Is this happening to you?", kinds: ["have_it", "not_happening"] };
}

function pollSummary(input: IssueReadoutInput): { fixedCount: number; stillCount: number; escalated: boolean } {
  const { pollFixedCount, pollStillCount, pollFixedNetworks, pollStillNetworks } = input.confirmations;
  return {
    fixedCount: pollFixedCount,
    stillCount: pollStillCount,
    escalated: pollFixedNetworks >= DISPLAY_THRESHOLD_NETWORKS || pollStillNetworks >= DISPLAY_THRESHOLD_NETWORKS,
  };
}

function evidenceSentence(input: IssueReadoutInput): string {
  const parts: string[] = [];
  if (input.directReportCount > 0) parts.push(plural(input.directReportCount, "earlier player report"));
  if (input.confirmations.affectedCount > 0) {
    parts.push(`${plural(input.confirmations.affectedCount, "check-in")} saying it is happening on ${input.patchVersion}`);
  }
  if (input.confirmations.byKind.not_happening.count > 0) parts.push(`${input.confirmations.byKind.not_happening.count} saying it is not happening`);
  if (parts.length === 0) return "No community check-ins on this patch yet.";
  return `${parts.join(" · ")}. Personal experiences, not a measure of all players.`;
}

function composeUnlocked(input: IssueReadoutInput): IssueReadout {
  const c = input.confirmations;
  const claim = hasClaimContext(input);
  const poll = claim ? pollSummary(input) : null;

  if (claim && (input.postClaimEvidenceCount > 0 || c.pollStillNetworks >= DISPLAY_THRESHOLD_NETWORKS)) {
    const voices: string[] = [];
    if (c.pollStillCount > 0) voices.push(`${plural(c.pollStillCount, "check-in")} saying it's still happening`);
    if (input.postClaimEvidenceCount > 0) {
      voices.push(`${plural(input.postClaimEvidenceCount, "exact-patch player report")} appeared after the claim`);
    }
    return {
      state: "still_happening",
      label: "Still happening reported",
      tone: "crimson",
      sentence: `Pearl Abyss claimed a fix in ${input.patchVersion} — ${voices.join(", and ")}.`,
      ask: pollAsk(input.patchVersion),
      poll,
    };
  }

  if (claim && c.pollFixedNetworks >= DISPLAY_THRESHOLD_NETWORKS && c.pollFixedCount > c.pollStillCount) {
    const still = c.pollStillCount > 0 ? ` ${plural(c.pollStillCount, "check-in")} saying it is still happening.` : "";
    return {
      state: "players_say_fixed",
      label: "Fixed for some",
      tone: "green",
      sentence: `${plural(c.pollFixedCount, "check-in")} saying ${input.patchVersion} fixed this for them.${still}`,
      ask: pollAsk(input.patchVersion),
      poll,
    };
  }

  if (claim) {
    const answered = c.pollFixedCount + c.pollStillCount;
    const early =
      answered > 0
        ? `Early answers so far: ${c.pollFixedCount} say fixed, ${c.pollStillCount} say still happening — not enough networks to weigh yet.`
        : "Quiet can mean fixed — or just quiet.";
    return {
      state: "fix_claimed_unverified",
      label: "Fix claimed — unverified",
      tone: "amber",
      sentence: `The fix claim for ${input.patchVersion} remains unverified. ${early}`,
      ask: pollAsk(input.patchVersion),
      poll,
    };
  }

  if (input.directReportCount > 0 || c.affectedNetworks >= DISPLAY_THRESHOLD_NETWORKS) {
    return {
      state: "confirmed",
      label: c.affectedCount > 0 ? "Community check-ins" : "Earlier player reports",
      tone: "crimson",
      sentence: evidenceSentence(input),
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (input.publicSignalsUnavailable) {
    return {
      state: "public_sources_unavailable",
      label: "Source leads unavailable",
      tone: "blue",
      sentence: "Public-source leads can't be read right now. Their count is missing, not zero.",
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (input.publicSignalCount > 0) {
    const playerRead =
      c.affectedCount > 0
        ? ` ${plural(c.affectedCount, "check-in")} also ${c.affectedCount === 1 ? "says" : "say"} this is happening — early responses only.`
        : "";
    return {
      state: "public_sources",
      label: "Public sources",
      tone: "amber",
      sentence: `Seen in ${plural(input.publicSignalCount, "public source")}. Source links stay leads, not player evidence.${playerRead}`,
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (input.candidateSignalCount > 0) {
    const playerRead =
      c.affectedCount > 0
        ? ` ${plural(c.affectedCount, "check-in")} also ${c.affectedCount === 1 ? "says" : "say"} this is happening — early responses only.`
        : "";
    return {
      state: "radar_lead",
      label: "Radar lead",
      tone: "blue",
      sentence: `The scanner spotted this ${plural(input.candidateSignalCount, "time")} — a lead, not evidence.${playerRead}`,
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (c.totalCount > 0) {
    return {
      state: "watching",
      label: "Open",
      tone: "dim",
      sentence: evidenceSentence(input),
      ask: haveItAsk(),
      poll: null,
    };
  }

  return {
    state: "watching",
    label: "Open",
    tone: "dim",
    sentence: "No community check-ins on this patch yet. The scanner continues checking public sources.",
    ask: haveItAsk(),
    poll: null,
  };
}

/** One brain: every displayed issue state derives from counts here, at read time. */
export function composeIssueReadout(input: IssueReadoutInput): IssueReadout {
  const hasCurrentClaim = hasClaimContext(input);
  if (!input.adminOverride) {
    if (input.checkinsAvailable === false) {
      return { state: "watching", hasCurrentClaim, label: "Check-ins unavailable", tone: "blue", sentence: "Current-patch check-ins could not be read. Their count is unavailable; source leads and earlier reports remain separate.", ask: null, poll: null };
    }
    return { ...composeUnlocked(input), hasCurrentClaim };
  }

  const meta = LOCKED_META[input.storedFixStatus] ?? LOCKED_META.reported;
  const claim = hasClaimContext(input);
  return {
    state: "locked",
    hasCurrentClaim,
    label: meta.label,
    tone: meta.tone,
    sentence: `Set by the maintainer. ${input.checkinsAvailable === false ? "Current-patch check-ins are unavailable; their count is not zero." : evidenceSentence(input)}`,
    ask: input.checkinsAvailable === false ? null : claim ? pollAsk(input.patchVersion) : haveItAsk(),
    poll: input.checkinsAvailable !== false && claim ? pollSummary(input) : null,
  };
}
