import type { ClusterConfirmations } from "@/lib/confirmations";

export type ReadoutState =
  | "locked"
  | "still_happening"
  | "players_say_fixed"
  | "fix_claimed_unverified"
  | "confirmed"
  | "public_sources"
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
};

export type IssueReadoutAsk = {
  question: string;
  kinds: ("have_it" | "still_happening" | "fixed_for_me")[];
};

export type IssueReadout = {
  state: ReadoutState;
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
  return { question: `Played since ${patchVersion} — fixed for you?`, kinds: ["fixed_for_me", "still_happening"] };
}

function haveItAsk(): IssueReadoutAsk {
  return { question: "Do you have this?", kinds: ["have_it"] };
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
  if (input.directReportCount > 0) parts.push(plural(input.directReportCount, "player report"));
  if (input.confirmations.affectedCount > 0) {
    parts.push(plural(input.confirmations.affectedCount, "one-tap confirmation"));
  }
  if (parts.length === 0) return "No player evidence on this patch yet.";
  return `${parts.join(" · ")} on this patch.`;
}

function composeUnlocked(input: IssueReadoutInput): IssueReadout {
  const c = input.confirmations;
  const claim = hasClaimContext(input);
  const poll = claim ? pollSummary(input) : null;

  if (claim && (input.postClaimEvidenceCount > 0 || c.pollStillNetworks >= DISPLAY_THRESHOLD_NETWORKS)) {
    const voices: string[] = [];
    if (c.pollStillCount > 0) voices.push(`${plural(c.pollStillCount, "player")} say it's still happening`);
    if (input.postClaimEvidenceCount > 0) {
      voices.push(`${plural(input.postClaimEvidenceCount, "exact-patch player report")} appeared after the claim`);
    }
    return {
      state: "still_happening",
      label: "Still happening",
      tone: "crimson",
      sentence: `Pearl Abyss claimed a fix in ${input.patchVersion} — ${voices.join(", and ")}.`,
      ask: pollAsk(input.patchVersion),
      poll,
    };
  }

  if (claim && c.pollFixedNetworks >= DISPLAY_THRESHOLD_NETWORKS && c.pollFixedCount > c.pollStillCount) {
    const still = c.pollStillCount > 0 ? ` ${plural(c.pollStillCount, "player")} still disagree${c.pollStillCount === 1 ? "s" : ""}.` : "";
    return {
      state: "players_say_fixed",
      label: "Players say fixed",
      tone: "green",
      sentence: `${plural(c.pollFixedCount, "player")} say ${input.patchVersion} fixed this for them.${still}`,
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
      sentence: `Pearl Abyss says ${input.patchVersion} fixed this. ${early}`,
      ask: pollAsk(input.patchVersion),
      poll,
    };
  }

  if (input.directReportCount > 0 || c.affectedNetworks >= DISPLAY_THRESHOLD_NETWORKS) {
    return {
      state: "confirmed",
      label: "Confirmed by players",
      tone: "crimson",
      sentence: evidenceSentence(input),
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (input.publicSignalCount > 0) {
    const playerRead =
      c.affectedCount > 0
        ? ` ${plural(c.affectedCount, "player")} also tapped this — not enough distinct networks to weigh yet.`
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
        ? ` ${plural(c.affectedCount, "player")} also tapped this — not enough distinct networks to weigh yet.`
        : "";
    return {
      state: "radar_lead",
      label: "Radar lead",
      tone: "blue",
      sentence: `The scanner spotted this ${plural(input.candidateSignalCount, "time")}. A lead is a rumor with a link, not evidence.${playerRead}`,
      ask: haveItAsk(),
      poll: null,
    };
  }

  if (c.affectedCount > 0) {
    const players = plural(c.affectedCount, "player");
    return {
      state: "watching",
      label: "Watching",
      tone: "dim",
      sentence: `${players} so far ${c.affectedCount === 1 ? "has" : "have"} this too — not enough distinct networks to weigh yet.`,
      ask: haveItAsk(),
      poll: null,
    };
  }

  return {
    state: "watching",
    label: "Watching",
    tone: "dim",
    sentence: "The scanner checks public sources every run. Nothing's turned up this patch.",
    ask: null,
    poll: null,
  };
}

/** One brain: every displayed issue state derives from counts here, at read time. */
export function composeIssueReadout(input: IssueReadoutInput): IssueReadout {
  if (!input.adminOverride) return composeUnlocked(input);

  const meta = LOCKED_META[input.storedFixStatus] ?? LOCKED_META.reported;
  const claim = hasClaimContext(input);
  return {
    state: "locked",
    label: meta.label,
    tone: meta.tone,
    sentence: `Set by the maintainer. ${evidenceSentence(input)}`,
    ask: claim ? pollAsk(input.patchVersion) : haveItAsk(),
    poll: claim ? pollSummary(input) : null,
  };
}
