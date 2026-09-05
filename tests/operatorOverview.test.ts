import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dispatch/Chrome", () => ({ OperatorShell: () => null }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/automation/runDisplay", () => ({
  summarizeRunMessages: (skips: string[]) => ({ operatorSummary: skips.length === 0 ? "No skips" : "Scheduled interval not reached" }),
}));
vi.mock("@/lib/collectionHealth", () => ({ collectionHealth: vi.fn() }));
vi.mock("@/lib/env", () => ({ platformContextConfigured: vi.fn(), steamPulseEnabled: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getAutomationAdminData: vi.fn(), getPublicScannerData: vi.fn() }));
vi.mock("@/lib/radar.server", () => ({ getPatchRadarData: vi.fn() }));

import { safeRunSummary } from "@/lib/operatorOverview";
import { runStatusLabel, scannerSummary } from "@/components/newspaper/OperatorOverview";

describe("operator overview run and scanner labels", () => {
  it("preserves known skipped and running run statuses without exposing errors", () => {
    expect(safeRunSummary({
      started_at: "2026-09-05T12:00:00.000Z",
      finished_at: "2026-09-05T12:00:01.000Z",
      status: "skipped",
      skips: ["recent_run"],
    })).toMatchObject({ status: "skipped", skipSummary: "Scheduled interval not reached" });
    expect(safeRunSummary({
      started_at: "2026-09-05T12:00:00.000Z",
      finished_at: null,
      status: "running",
      skips: [],
    })).toMatchObject({ status: "running", skipSummary: "No skips" });
    expect(runStatusLabel("skipped")).toBe("Skipped");
    expect(runStatusLabel("running")).toBe("Running");
  });

  it("does not infer scheduling from a zero failed-run aggregate", () => {
    expect(scannerSummary(true, 0)).toEqual({
      label: "Scanner",
      status: "No recorded failures",
      detail: "No failed runs are recorded in the last 7 days. This does not establish a schedule.",
      tone: "",
    });
  });
});
