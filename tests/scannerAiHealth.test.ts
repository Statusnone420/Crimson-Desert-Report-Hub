import { describe, expect, it } from "vitest";
import { scannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";

const run = (overrides: Partial<ScannerAiRun> = {}): ScannerAiRun => ({ started_at: "2026-09-06T20:00:00Z", status: "success", mode: "scheduled", skips: [], llm_calls_used: 1, progress: { llmSucceeded: 1 }, ...overrides });

describe("private scanner AI health", () => {
  it("flags a completed scan whose AI route failed", () => {
    const health = scannerAiHealth([run({ skips: ["openrouter_no_route", "llm_allowance_exhausted"], progress: { llmSucceeded: 0 } })]);
    expect(health.state).toBe("unavailable");
    expect(health.code).toBe("openrouter_no_route");
    expect(health.lastSuccessAt).toBeNull();
  });
  it("does not clear a route failure after an idle scan, skipped wake-up, or dry run", () => {
    expect(scannerAiHealth([
      run({ started_at: "2026-09-06T23:00:00Z", mode: "dry_run" }),
      run({ started_at: "2026-09-06T22:00:00Z", status: "skipped" }),
      run({ started_at: "2026-09-06T21:00:00Z", llm_calls_used: 0, progress: { llmSucceeded: 0 } }),
      run({ started_at: "2026-09-06T21:30:00Z", llm_calls_used: 1, progress: null }),
      run({ skips: ["openrouter_no_route"], progress: { llmSucceeded: 0 } }),
    ]).state).toBe("unavailable");
  });
  it("requires a validated result for recovery and retains its timestamp", () => {
    const health = scannerAiHealth([run(), run({ started_at: "2026-09-06T19:00:00Z", skips: ["openrouter_no_route"], progress: { llmSucceeded: 0 } })]);
    expect(health).toMatchObject({ state: "healthy", lastSuccessAt: "2026-09-06T20:00:00Z" });
  });
  it("orders known AI outcomes by completion time", () => {
    const health = scannerAiHealth([
      run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T22:00:00Z", skips: ["openrouter_provider_failure"], progress: { llmSucceeded: 0 } }),
      run({ started_at: "2026-09-06T21:00:00Z", finished_at: "2026-09-06T21:30:00Z" }),
    ]);
    expect(health).toMatchObject({ state: "unavailable", code: "openrouter_provider_failure", lastSuccessAt: "2026-09-06T21:30:00Z" });
  });
  it("recognizes recovery when an earlier-started validation finishes last", () => {
    const health = scannerAiHealth([
      run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T22:00:00Z" }),
      run({ started_at: "2026-09-06T21:00:00Z", finished_at: "2026-09-06T21:30:00Z", skips: ["openrouter_provider_failure"], progress: { llmSucceeded: 0 } }),
    ]);
    expect(health).toMatchObject({ state: "healthy", code: null, lastSuccessAt: "2026-09-06T22:00:00Z" });
  });
  it("falls back safely to start time for legacy rows without a completion time", () => {
    const health = scannerAiHealth([
      run({ started_at: "2026-09-06T22:00:00Z", finished_at: null }),
      run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T21:00:00Z", skips: ["openrouter_provider_failure"], progress: { llmSucceeded: 0 } }),
    ]);
    expect(health).toMatchObject({ state: "healthy", lastSuccessAt: "2026-09-06T22:00:00Z" });
  });
  it("falls back to a finite start time when a completion timestamp is invalid", () => {
    expect(scannerAiHealth([run({ finished_at: "invalid" })])).toMatchObject({
      state: "healthy",
      lastSuccessAt: "2026-09-06T20:00:00Z",
    });
  });
  it("recognizes validated response metadata independently of the attempted-call counter", () => {
    expect(scannerAiHealth([run({ llm_calls_used: 0 })])).toMatchObject({ state: "healthy", lastSuccessAt: "2026-09-06T20:00:00Z" });
  });
  it("retains the latest validated timestamp beyond 100 later AI failures", () => {
    const failures = Array.from({ length: 101 }, (_, index) => run({
      started_at: new Date(Date.parse("2026-09-07T00:00:00Z") + index * 60_000).toISOString(),
      skips: ["openrouter_no_route"],
      progress: { llmSucceeded: 0 },
    }));
    const health = scannerAiHealth([
      ...failures,
      run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T20:01:00Z" }),
    ]);
    expect(health).toMatchObject({ state: "unavailable", lastSuccessAt: "2026-09-06T20:01:00Z" });
  });
  it("distinguishes partial AI success from full unavailability", () => {
    expect(scannerAiHealth([run({ skips: ["openrouter_invalid_json"] })]).state).toBe("limited");
  });
  it("does not call per-run allowance exhaustion an outage", () => {
    expect(scannerAiHealth([run({ skips: ["llm_allowance_exhausted"] })]).state).toBe("healthy");
  });
  it("shows a reached monthly budget and intentional pause honestly", () => {
    expect(scannerAiHealth([run({ skips: ["llm_budget_capped"] })]).state).toBe("limited");
    expect(scannerAiHealth([run()], { paused: true }).state).toBe("idle");
    expect(scannerAiHealth([run()], { monthlyLlmUsdCap: 0 }).state).toBe("idle");
  });
  it("does not infer success from historical attempted-call counts or unreadable records", () => {
    expect(scannerAiHealth([run({ progress: null })]).state).toBe("idle");
    expect(scannerAiHealth([], { readAvailable: false }).state).toBe("unavailable");
  });
});
