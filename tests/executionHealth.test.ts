import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScannerExecutionHealth } from "@/components/scanner/ScannerExecutionHealth";
import { getScannerExecutionHealth } from "@/lib/automation/executionHealth";
import type { ScannerExecutionRead } from "@/lib/automation/diagnostics";

const now = new Date("2026-09-12T16:00:00.000Z");
const attempt = {
  id: "6fd20980-2f25-4c0b-84ec-03ecacbfeebb",
  startedAt: "2026-09-12T15:00:00.000Z",
  finishedAt: "2026-09-12T15:01:00.000Z",
  outcome: "success" as const,
  diagnostics: [],
  errorCount: 0,
  skipReason: null,
  nextEligibleAt: null,
  httpStatus: 200,
};

function available(overrides: Partial<NonNullable<ScannerExecutionRead["snapshot"]>> = {}): ScannerExecutionRead {
  return {
    state: "available",
    code: null,
    detail: "Execution state loaded.",
    started: null,
    snapshot: {
      version: 1,
      latestAttempt: attempt,
      lastSuccessfulScanAt: attempt.finishedAt,
      lastSuccessfulAiAt: attempt.finishedAt,
      lastFailedAttempt: null,
      ...overrides,
    },
  };
}

describe("getScannerExecutionHealth", () => {
  it("keeps a stale trigger-start marker behind a newer completion from looking running", () => {
    const health = getScannerExecutionHealth({
      ...available(),
      started: { id: "7a4fe516-32a3-4ebf-af84-bf30d8e2ee6f", startedAt: "2026-09-12T14:59:00.000Z" },
    }, now);

    expect(health).toMatchObject({ tone: "ok", statusLabel: "Latest trigger completed", needsAttention: false });
  });

  it("separates a recent observed start from a missing completion", () => {
    const running = getScannerExecutionHealth({
      ...available(),
      started: { id: "7a4fe516-32a3-4ebf-af84-bf30d8e2ee6f", startedAt: "2026-09-12T15:56:00.000Z" },
    }, now);
    expect(running).toMatchObject({ tone: "caution", statusLabel: "Trigger running", needsAttention: false });

    const missing = getScannerExecutionHealth({
      ...available(),
      started: { id: "7a4fe516-32a3-4ebf-af84-bf30d8e2ee6f", startedAt: "2026-09-12T15:53:00.000Z" },
    }, now);
    expect(missing).toMatchObject({ tone: "danger", statusLabel: "Trigger completion missing", needsAttention: true });
    expect(missing.detail).toContain("observed gap");
  });

  it("classifies a first trigger start without a snapshot as running or missing completion", () => {
    const read = (startedAt: string): ScannerExecutionRead => ({
      state: "available",
      code: null,
      detail: "Execution start loaded.",
      started: { id: "7a4fe516-32a3-4ebf-af84-bf30d8e2ee6f", startedAt },
      snapshot: null,
    });

    expect(getScannerExecutionHealth(read("2026-09-12T15:56:00.000Z"), now)).toMatchObject({
      tone: "caution",
      statusLabel: "Trigger running",
      currentAttemptId: "7a4fe516-32a3-4ebf-af84-bf30d8e2ee6f",
    });
    expect(getScannerExecutionHealth(read("2026-09-12T15:53:00.000Z"), now)).toMatchObject({
      tone: "danger",
      statusLabel: "Trigger completion missing",
    });
  });

  it("does not treat a saved running outcome as a completed scan", () => {
    const health = getScannerExecutionHealth(available({
      latestAttempt: { ...attempt, outcome: "running", finishedAt: "2026-09-12T15:59:00.000Z" },
    }), now);

    expect(health).toMatchObject({ tone: "caution", statusLabel: "Trigger running", needsAttention: false });
  });

  it("marks an old saved running outcome as an overdue heartbeat", () => {
    const health = getScannerExecutionHealth(available({
      latestAttempt: { ...attempt, outcome: "running", finishedAt: "2026-09-12T14:00:00.000Z" },
    }), now);

    expect(health).toMatchObject({ tone: "danger", statusLabel: "Scanner heartbeat overdue", needsAttention: true });
  });

  it("keeps a failure before a later skip actionable until a later successful scan", () => {
    const failure = {
      ...attempt,
      finishedAt: "2026-09-12T15:00:00.000Z",
      outcome: "failed" as const,
      diagnostics: [{ stage: "run_finalize" as const, code: "database_timeout" as const }],
      errorCount: 1,
    };
    const skipped = {
      ...attempt,
      finishedAt: "2026-09-12T15:55:00.000Z",
      outcome: "skipped" as const,
      skipReason: "recent_run" as const,
    };
    const unresolved = getScannerExecutionHealth(available({
      latestAttempt: skipped,
      lastSuccessfulScanAt: "2026-09-12T14:00:00.000Z",
      lastSuccessfulAiAt: "2026-09-12T14:00:00.000Z",
      lastFailedAttempt: failure,
    }), now);
    const recovered = getScannerExecutionHealth(available({
      latestAttempt: { ...attempt, finishedAt: "2026-09-12T15:55:00.000Z" },
      lastSuccessfulScanAt: "2026-09-12T15:55:00.000Z",
      lastSuccessfulAiAt: "2026-09-12T15:55:00.000Z",
      lastFailedAttempt: failure,
    }), now);

    expect(unresolved).toMatchObject({
      tone: "danger",
      statusLabel: "Earlier trigger failure remains unresolved",
      needsAttention: true,
      detail: expect.stringContaining("Saving the completed run"),
    });
    expect(recovered).toMatchObject({ tone: "ok", statusLabel: "Latest trigger completed", needsAttention: false });
  });

  it("retains a prior failure after a later success and flags an overdue heartbeat", () => {
    const failed = { ...attempt, finishedAt: "2026-09-12T13:00:00.000Z", outcome: "failed" as const, diagnostics: [{ stage: "run_create" as const, code: "database_timeout" as const }], errorCount: 1 };
    const health = getScannerExecutionHealth(available({
      latestAttempt: { ...attempt, finishedAt: "2026-09-12T14:00:00.000Z" },
      lastSuccessfulScanAt: "2026-09-12T14:00:00.000Z",
      lastSuccessfulAiAt: "2026-09-12T14:00:00.000Z",
      lastFailedAttempt: failed,
    }), now);

    expect(health).toMatchObject({ tone: "danger", statusLabel: "Scanner heartbeat overdue", needsAttention: true, lastFailure: failed });
  });

  it.each([
    { state: "unavailable", code: "access_denied", label: "Execution evidence access unavailable" },
    { state: "unavailable", code: "invalid_response", label: "Execution evidence malformed" },
    { state: "not_configured", code: null, label: "Execution evidence not configured" },
    { state: "no_attempt", code: null, label: "No execution recorded" },
  ] as const)("does not present a $state execution read as healthy", ({ state, code, label }) => {
    const health = getScannerExecutionHealth({ state, code, detail: "The execution read did not establish a completed trigger.", started: null, snapshot: null }, now);
    expect(health).toMatchObject({ tone: "unavailable", statusLabel: label, needsAttention: true });
  });

  it("retains a validated snapshot when the companion KV read is unavailable", () => {
    const health = getScannerExecutionHealth({
      ...available(),
      state: "unavailable",
      code: "read_timeout",
      detail: "The status read timed out.",
    }, now);

    expect(health).toMatchObject({
      tone: "unavailable",
      latestAttempt: expect.objectContaining({ id: attempt.id }),
      lastSuccessfulScanAt: attempt.finishedAt,
      lastSuccessfulAiAt: attempt.finishedAt,
    });
  });

  it("renders the private card with separate trigger and policy timing", () => {
    const markup = renderToStaticMarkup(createElement(ScannerExecutionHealth, {
      execution: available(),
      nowIso: now.toISOString(),
      policyEligibleAt: "2026-09-12T17:30:00.000Z",
    }));

    expect(markup).toContain("Scheduled execution evidence");
    expect(markup).toContain("Next hourly trigger opportunity");
    expect(markup).toContain("Policy eligibility");
    expect(markup).toContain("Last successful AI");
    expect(markup).toContain(attempt.id);
    expect(markup).toContain("HTTP status: 200.");
  });

  it("separates a paused policy from an unavailable policy read", () => {
    const markup = renderToStaticMarkup(createElement(ScannerExecutionHealth, {
      execution: available(),
      nowIso: now.toISOString(),
      policyPaused: true,
    }));

    expect(markup).toContain("Scanner policy is paused.");
    expect(markup).not.toContain("policy read did not finish");
  });
});
