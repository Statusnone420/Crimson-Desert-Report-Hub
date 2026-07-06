export type EvidenceLadderState = "watching" | "candidates" | "corroborated" | "player_confirmed";

export type LadderInput = {
  directReportCount: number;
  publicSignalCount: number;
  candidateSignalCount: number;
};

export function clusterEvidenceState(input: LadderInput): EvidenceLadderState {
  if (input.directReportCount > 0) return "player_confirmed";
  if (input.publicSignalCount > 0) return "corroborated";
  if (input.candidateSignalCount > 0) return "candidates";
  return "watching";
}

export const LADDER_LABELS: Record<EvidenceLadderState, string> = {
  watching: "Watching",
  candidates: "Unconfirmed",
  corroborated: "Multiple sources",
  player_confirmed: "Players confirm",
};

export const LADDER_DESCRIPTIONS: Record<EvidenceLadderState, string> = {
  watching: "The scanner checks public sources every run. Nothing's turned up yet.",
  candidates:
    "The scanner found mentions online, but not enough separate sources to stand behind it yet. Only the count is shown — the text stays private.",
  corroborated: "Two or more separate public sources report this. They're linked below.",
  player_confirmed: "Players have sent in reports confirming this.",
};
