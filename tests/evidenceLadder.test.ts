import { describe, expect, it } from "vitest";
import { clusterEvidenceState, LADDER_DESCRIPTIONS, LADDER_LABELS } from "@/lib/evidenceLadder";

describe("clusterEvidenceState", () => {
  it("returns watching when there is no evidence at all", () => {
    expect(clusterEvidenceState({ directReportCount: 0, publicSignalCount: 0, candidateSignalCount: 0 })).toBe(
      "watching",
    );
  });

  it("returns candidates when only private candidate signals exist", () => {
    expect(clusterEvidenceState({ directReportCount: 0, publicSignalCount: 0, candidateSignalCount: 3 })).toBe(
      "candidates",
    );
  });

  it("returns corroborated when a public signal exists, even alongside candidates", () => {
    expect(clusterEvidenceState({ directReportCount: 0, publicSignalCount: 1, candidateSignalCount: 5 })).toBe(
      "corroborated",
    );
  });

  it("returns player_confirmed when a direct report exists, even alongside candidates and public signals", () => {
    expect(clusterEvidenceState({ directReportCount: 1, publicSignalCount: 2, candidateSignalCount: 5 })).toBe(
      "player_confirmed",
    );
  });

  it("prioritizes player_confirmed over corroborated when both a direct report and candidates are present", () => {
    expect(clusterEvidenceState({ directReportCount: 1, publicSignalCount: 0, candidateSignalCount: 4 })).toBe(
      "player_confirmed",
    );
  });
});

describe("LADDER_LABELS", () => {
  it("has a label for every state", () => {
    expect(LADDER_LABELS.watching).toBe("Watching");
    expect(LADDER_LABELS.candidates).toBe("Candidates under review");
    expect(LADDER_LABELS.corroborated).toBe("Corroborated");
    expect(LADDER_LABELS.player_confirmed).toBe("Player-confirmed");
  });
});

describe("LADDER_DESCRIPTIONS", () => {
  it("has a description for every state", () => {
    expect(LADDER_DESCRIPTIONS.watching).toBe(
      "The scanner checks public sources for this on every run. Nothing found yet.",
    );
    expect(LADDER_DESCRIPTIONS.candidates).toBe(
      "The scanner found mentions that have not passed the independence threshold. Counts only — content stays private until corroborated.",
    );
    expect(LADDER_DESCRIPTIONS.corroborated).toBe(
      "Multiple independent public sources describe this issue. Sources are linked below.",
    );
    expect(LADDER_DESCRIPTIONS.player_confirmed).toBe("Approved player reports confirm this issue.");
  });
});
