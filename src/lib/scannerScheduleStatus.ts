export type ScannerScheduleRun = {
  status: string;
  skips: string[];
};

export type ScannerScheduleStatus = {
  label: "RUNNING" | "PAUSED" | "CAPPED" | "ACTIVE";
  tone: "green" | "amber" | "red";
  toneClass: "is-green" | "is-amber" | "is-crimson";
};

function runReachedCap(run: ScannerScheduleRun | null): boolean {
  return Boolean(
    run?.skips.some((skip) => skip.includes("tavily_credit_cap") || skip.includes("llm_budget_capped")),
  );
}

export function scannerScheduleStatus(
  control: { paused: boolean },
  activeRun: { id: string } | null,
  lastRun: ScannerScheduleRun | null,
): ScannerScheduleStatus {
  if (activeRun) return { label: "RUNNING", tone: "amber", toneClass: "is-amber" };
  if (control.paused) return { label: "PAUSED", tone: "amber", toneClass: "is-amber" };
  if (runReachedCap(lastRun)) return { label: "CAPPED", tone: "red", toneClass: "is-crimson" };
  return { label: "ACTIVE", tone: "green", toneClass: "is-green" };
}
