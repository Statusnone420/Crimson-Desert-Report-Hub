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
  candidates: "Candidates under review",
  corroborated: "Corroborated",
  player_confirmed: "Player-confirmed",
};

export const LADDER_DESCRIPTIONS: Record<EvidenceLadderState, string> = {
  watching: "The scanner checks public sources for this on every run. Nothing found yet.",
  candidates:
    "The scanner found mentions that have not passed the independence threshold. Counts only — content stays private until corroborated.",
  corroborated: "Multiple independent public sources describe this issue. Sources are linked below.",
  player_confirmed: "Approved player reports confirm this issue.",
};
