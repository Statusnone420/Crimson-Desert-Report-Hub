export type ScannerScheduleStatus = {
  label: "RUNNING" | "PAUSED" | "CAPPED" | "ACTIVE";
  tone: "green" | "amber" | "red";
  toneClass: "is-green" | "is-amber" | "is-crimson";
};

export function scannerScheduleStatus(
  control: { paused: boolean },
  activeRun: { id: string } | null,
  budgetCapped: boolean,
): ScannerScheduleStatus {
  if (activeRun) return { label: "RUNNING", tone: "amber", toneClass: "is-amber" };
  if (control.paused) return { label: "PAUSED", tone: "amber", toneClass: "is-amber" };
  if (budgetCapped) return { label: "CAPPED", tone: "red", toneClass: "is-crimson" };
  return { label: "ACTIVE", tone: "green", toneClass: "is-green" };
}
