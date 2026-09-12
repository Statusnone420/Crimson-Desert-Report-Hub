import { describe, expect, it } from "vitest";
import { nextHourlyScannerWake, parseScannerAttempt, scannerDiagnostic, scannerTimestamp, ScannerOperationError } from "@/lib/automation/diagnostics";

describe("safe scanner diagnostics", () => {
  it("classifies database timeouts without returning their text", () => {
    expect(scannerDiagnostic("budget_read", "Gateway Timeout: private query")).toEqual({ stage: "budget_read", code: "database_timeout" });
    expect(scannerDiagnostic("run_create", { code: "42501", message: "private relation" })).toEqual({ stage: "run_create", code: "database_permission_denied" });
  });
  it("does not invent a database cause for a provider-stage timeout", () => {
    expect(scannerDiagnostic("scan", new Error("Provider timeout"))).toEqual({ stage: "scan", code: "operation_failed" });
    expect(scannerDiagnostic("patch_sync", new Error("official patch fetch failed: 503"))).toEqual({ stage: "patch_sync", code: "operation_failed" });
  });
  it("preserves the inner operation stage through a caller's catch", () => {
    expect(scannerDiagnostic("scan", new ScannerOperationError("run_create", new Error("Gateway Timeout")))).toEqual({ stage: "run_create", code: "database_timeout" });
  });
  it.each(["2026-02-31T00:00:00Z", "2026-09-12", "not a time", "2026-09-12T24:00:00Z"])("rejects invalid stored time %s", (value) => {
    expect(scannerTimestamp(value)).toBe(false);
  });
  it.each(["2026-09-12T00:00:00Z", "2026-09-12T00:00:00.1Z", "2026-09-12T00:00:00.123Z"])("accepts valid UTC time %s", (value) => {
    expect(scannerTimestamp(value)).toBe(true);
  });
  it("rejects a successful attempt that still contains failures", () => {
    expect(parseScannerAttempt({ id: "214ff53e-dc69-4792-90b0-ea074a137685", startedAt: "2026-09-12T15:00:00Z", finishedAt: "2026-09-12T15:01:00Z", outcome: "success", errorCount: 1, diagnostics: [{ stage: "run_create", code: "database_timeout" }], skipReason: null, nextEligibleAt: null, httpStatus: 200 })).toBeNull();
  });
  it("distinguishes eligibility from the next hourly dispatch and honors the existing jitter grace", () => {
    const now = new Date("2026-09-12T15:05:00Z");
    expect(nextHourlyScannerWake(now)).toBe("2026-09-12T16:00:00.000Z");
    expect(nextHourlyScannerWake(now, "2026-09-12T16:01:00Z")).toBe("2026-09-12T16:00:00.000Z");
    expect(nextHourlyScannerWake(now, "2026-09-12T16:05:00Z")).toBe("2026-09-12T17:00:00.000Z");
  });
});
