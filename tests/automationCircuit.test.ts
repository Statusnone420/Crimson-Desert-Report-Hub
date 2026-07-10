import { describe, expect, it } from "vitest";
import { circuitReadStartIso, llmPausedFromCircuitRead, openRouterCircuitOpenFromRuns } from "@/lib/automation/circuit";

const NOW = new Date("2026-07-05T12:00:00.000Z");

function blip(startedAt: string) {
  return { started_at: startedAt, skips: ["openrouter_cost_unverified"] };
}

describe("openRouterCircuitOpenFromRuns", () => {
  it("stays closed for a single recent cost-unverified run", () => {
    expect(openRouterCircuitOpenFromRuns([blip("2026-07-05T09:00:00.000Z")], NOW)).toBe(false);
  });

  it("opens when three cost-unverified runs land inside 24 hours", () => {
    const rows = [blip("2026-07-05T02:00:00.000Z"), blip("2026-07-04T20:00:00.000Z"), blip("2026-07-04T14:00:00.000Z")];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(true);
  });

  it("ignores cost-unverified runs older than 24 hours", () => {
    const rows = [blip("2026-07-04T06:00:00.000Z"), blip("2026-07-03T12:00:00.000Z"), blip("2026-07-02T12:00:00.000Z")];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(false);
  });

  it("counts blips across a UTC month boundary inside the window", () => {
    const boundaryNow = new Date("2026-07-01T10:00:00.000Z");
    const rows = [blip("2026-06-30T20:00:00.000Z"), blip("2026-06-30T23:00:00.000Z"), blip("2026-07-01T02:00:00.000Z")];
    expect(openRouterCircuitOpenFromRuns(rows, boundaryNow)).toBe(true);
  });

  it("latches for the month on a money anomaly", () => {
    const rows = [{ started_at: "2026-07-02T08:00:00.000Z", skips: ["openrouter_unexpected_charge"] }];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(true);
    const exceeded = [{ started_at: "2026-07-02T08:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];
    expect(openRouterCircuitOpenFromRuns(exceeded, NOW)).toBe(true);
  });

  it("does not let a previous month's money anomaly inside the 24h read latch the new month", () => {
    const boundaryNow = new Date("2026-07-01T10:00:00.000Z");
    const rows = [{ started_at: "2026-06-30T20:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];
    expect(openRouterCircuitOpenFromRuns(rows, boundaryNow)).toBe(false);
  });

  it("treats malformed rows as harmless", () => {
    const rows = [
      { started_at: null, skips: ["openrouter_cost_unverified"] },
      { started_at: "2026-07-05T09:00:00.000Z", skips: "not-an-array" },
      {},
    ];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(false);
  });
});

describe("llmPausedFromCircuitRead", () => {
  it("fails closed when the run-history read errored, matching the engine", () => {
    expect(llmPausedFromCircuitRead(null, { message: "read outage" }, NOW)).toBe(true);
    expect(llmPausedFromCircuitRead([], { message: "read outage" }, NOW)).toBe(true);
  });

  it("evaluates the circuit normally on a successful read", () => {
    expect(llmPausedFromCircuitRead([blip("2026-07-05T09:00:00.000Z")], null, NOW)).toBe(false);
    const tripped = [
      blip("2026-07-05T02:00:00.000Z"),
      blip("2026-07-04T20:00:00.000Z"),
      blip("2026-07-04T14:00:00.000Z"),
    ];
    expect(llmPausedFromCircuitRead(tripped, null, NOW)).toBe(true);
  });

  it("treats a null row set without an error as an empty history", () => {
    expect(llmPausedFromCircuitRead(null, null, NOW)).toBe(false);
  });
});

describe("circuitReadStartIso", () => {
  it("reads from the month start when the 24h window is inside the month", () => {
    expect(circuitReadStartIso(NOW)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("reaches into the previous month during the first 24 hours of a month", () => {
    expect(circuitReadStartIso(new Date("2026-07-01T10:00:00.000Z"))).toBe("2026-06-30T10:00:00.000Z");
  });
});
