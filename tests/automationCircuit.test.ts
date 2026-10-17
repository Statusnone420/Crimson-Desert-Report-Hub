import { describe, expect, it } from "vitest";
import { circuitReadStartIso, llmPausedFromCircuitRead, openRouterCircuitOpenFromRuns } from "@/lib/automation/circuit";

const NOW = new Date("2026-07-05T12:00:00.000Z");

function blip(startedAt: string) {
  return { started_at: startedAt, skips: ["openrouter_cost_unverified"] };
}

describe("openRouterCircuitOpenFromRuns", () => {
  it("never opens on unverified costs, however many land in a day", () => {
    // An unverified cost stops AI for the rest of its own run only.
    const rows = [blip("2026-07-05T09:00:00.000Z"), blip("2026-07-05T02:00:00.000Z"),
      blip("2026-07-04T20:00:00.000Z"), blip("2026-07-04T14:00:00.000Z")];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(false);
  });

  it("latches for the month on a money anomaly", () => {
    const rows = [{ started_at: "2026-07-02T08:00:00.000Z", skips: ["openrouter_unexpected_charge"] }];
    expect(openRouterCircuitOpenFromRuns(rows, NOW)).toBe(true);
    const exceeded = [{ started_at: "2026-07-02T08:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];
    expect(openRouterCircuitOpenFromRuns(exceeded, NOW)).toBe(true);
  });

  it("does not let a previous month's money anomaly latch the new month", () => {
    const boundaryNow = new Date("2026-07-01T10:00:00.000Z");
    const rows = [{ started_at: "2026-06-30T20:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];
    expect(openRouterCircuitOpenFromRuns(rows, boundaryNow)).toBe(false);
  });

  it("never trips on routing refusals", () => {
    const refusals = [
      { started_at: "2026-07-05T02:00:00.000Z", skips: ["openrouter_no_route"] },
      { started_at: "2026-07-04T20:00:00.000Z", skips: ["openrouter_no_route"] },
    ];
    expect(openRouterCircuitOpenFromRuns(refusals, NOW)).toBe(false);
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
  it("reports unknown when the run-history read errored, rather than claiming the circuit is open", () => {
    // The engine still fails closed on this failure — it evaluates the circuit
    // itself before spending. A status display has no such decision to make, and
    // "we could not read it" is not evidence that the circuit is open.
    expect(llmPausedFromCircuitRead(null, { message: "read outage" }, NOW)).toBeNull();
    expect(llmPausedFromCircuitRead([], { message: "read outage" }, NOW)).toBeNull();
  });

  it("evaluates the circuit normally on a successful read", () => {
    expect(llmPausedFromCircuitRead([blip("2026-07-05T09:00:00.000Z")], null, NOW)).toBe(false);
    const anomaly = [{ started_at: "2026-07-02T08:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];
    expect(llmPausedFromCircuitRead(anomaly, null, NOW)).toBe(true);
  });

  it("treats a null row set without an error as an empty history", () => {
    expect(llmPausedFromCircuitRead(null, null, NOW)).toBe(false);
  });
});

describe("circuitReadStartIso", () => {
  it("reads from the UTC month start", () => {
    expect(circuitReadStartIso(NOW)).toBe("2026-07-01T00:00:00.000Z");
    expect(circuitReadStartIso(new Date("2026-07-01T10:00:00.000Z"))).toBe("2026-07-01T00:00:00.000Z");
  });
});
