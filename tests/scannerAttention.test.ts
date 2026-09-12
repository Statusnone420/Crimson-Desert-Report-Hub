import { describe, expect, it } from "vitest";
import { getScannerAttention } from "@/lib/scannerAttention";
import type { CollectionHealth } from "@/lib/collectionHealth";
import type { ScannerExecutionHealth } from "@/lib/automation/executionHealth";

const healthyCollection: CollectionHealth = {
  status: "ok",
  attentionCount: 0,
  lanes: [{
    key: "steam",
    label: "Steam reviews",
    state: "ok",
    labelText: "On schedule",
    lastCaptureAt: "2026-09-07T14:00:00.000Z",
    lastSuccessfulCaptureAt: "2026-09-07T14:00:00.000Z",
    latestAttemptAt: "2026-09-07T14:00:00.000Z",
    detail: "The latest capture is current.",
    nextAction: null,
    needsAttention: false,
  }],
};

describe("getScannerAttention", () => {
  it("counts one AI item when both AI health and the known cost circuit report the same pause", () => {
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code: "openrouter_circuit_open", message: "AI processing is paused after a cost verification failure.", lastSuccessAt: null },
      llmPaused: true,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBe(1);
    expect(attention.items).toEqual([expect.objectContaining({ id: "ai-processing", label: "AI processing unavailable" })]);
  });

  it.each([
    "openrouter_cost_unverified",
    "openrouter_unexpected_charge",
    "openrouter_budget_exceeded",
  ])("deduplicates a paused circuit from its %s trigger", (code) => {
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code, message: "AI processing stopped for cost safety.", lastSuccessAt: null },
      llmPaused: true,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBe(1);
    expect(attention.items.map((item) => item.id)).toEqual(["ai-processing"]);
  });

  it("does not call a missing AI health read clear", () => {
    const attention = getScannerAttention({
      llmPaused: false,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBeNull();
    expect(attention.items).toContainEqual(expect.objectContaining({ id: "ai-processing", label: "AI processing health unavailable" }));
  });

  it("keeps an unavailable AI history as a named health item", () => {
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code: "ai_history_unavailable", message: "AI run history could not be read.", lastSuccessAt: null },
      llmPaused: false,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBe(1);
    expect(attention.items).toEqual([expect.objectContaining({ id: "ai-processing", label: "AI processing unavailable" })]);
  });

  it("keeps a separate AI failure and a known cost pause as two incidents", () => {
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code: "openrouter_provider_failure", message: "The AI provider could not complete a request.", lastSuccessAt: null },
      llmPaused: true,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBe(2);
    expect(attention.items.map((item) => item.id)).toEqual(["ai-processing", "ai-cost-safety-paused"]);
  });

  it("keeps unrelated simultaneous alerts when it deduplicates the cost circuit", () => {
    const collection: CollectionHealth = {
      status: "attention",
      attentionCount: 1,
      lanes: [{ ...healthyCollection.lanes[0], state: "delayed", labelText: "Delayed", needsAttention: true }],
    };
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code: "openrouter_unexpected_charge", message: "AI processing stopped after an unexpected charge.", lastSuccessAt: null },
      llmPaused: true,
      failedRuns: 2,
      radarAvailable: true,
      collection,
    });

    expect(attention.count).toBe(3);
    expect(attention.items.map((item) => item.id)).toEqual(["failed-runs", "ai-processing", "collection-steam"]);
  });

  it("counts a group of failed runs as one health item", () => {
    const attention = getScannerAttention({ aiHealth: { state: "healthy", code: null, message: "Validated.", lastSuccessAt: null }, llmPaused: false, failedRuns: 3, radarAvailable: true, collection: healthyCollection });

    expect(attention.count).toBe(1);
    expect(attention.items).toEqual([expect.objectContaining({ id: "failed-runs", label: "3 failed runs in 7 days" })]);
  });

  it("keeps independent collection problems as named items", () => {
    const collection: CollectionHealth = {
      status: "attention",
      attentionCount: 2,
      lanes: [
        { ...healthyCollection.lanes[0], key: "steam", state: "delayed", labelText: "Delayed", detail: "Steam is late.", nextAction: "Check Steam.", needsAttention: true },
        { ...healthyCollection.lanes[0], key: "twitch", label: "Twitch", state: "unavailable", labelText: "Unavailable", detail: "Twitch failed.", nextAction: "Check Twitch.", needsAttention: true },
      ],
    };
    const attention = getScannerAttention({ aiHealth: { state: "healthy", code: null, message: "Validated.", lastSuccessAt: null }, llmPaused: false, failedRuns: 0, radarAvailable: true, collection });

    expect(attention.count).toBe(2);
    expect(attention.items.map((item) => item.id)).toEqual(["collection-steam", "collection-twitch"]);
  });

  it("never presents a missing health read as all clear", () => {
    const attention = getScannerAttention({ aiHealth: { state: "healthy", code: null, message: "Validated.", lastSuccessAt: null }, llmPaused: false, failedRuns: null, radarAvailable: false, collection: healthyCollection });

    expect(attention.count).toBeNull();
    expect(attention.items).toContainEqual(expect.objectContaining({ id: "scanner-health-unavailable" }));
  });

  it("adds a named trigger failure without treating a healthy policy as proof of execution", () => {
    const execution: ScannerExecutionHealth = {
      tone: "danger",
      statusLabel: "Latest trigger failed",
      detail: "The trigger could not save its completion.",
      action: "Check private runtime logs.",
      needsAttention: true,
      latestAttempt: null,
      latestAttemptAt: null,
      observedStartAt: null,
      lastSuccessfulScanAt: null,
      lastSuccessfulAiAt: null,
      lastFailure: null,
      nextHourlyTriggerAt: "2026-09-12T16:00:00.000Z",
      currentAttemptId: null,
      currentAttemptStartedAt: null,
      currentAttemptFinishedAt: null,
      currentAttemptOutcome: null,
      currentAttemptHttpStatus: null,
      executionReadAvailable: true,
    };
    const attention = getScannerAttention({
      aiHealth: { state: "healthy", code: null, message: "Validated.", lastSuccessAt: null },
      llmPaused: false,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
      execution,
    });

    expect(attention.count).toBe(1);
    expect(attention.items).toContainEqual(expect.objectContaining({ id: "scanner-execution", label: "Latest trigger failed" }));
  });

  it("keeps a successful radar read separate from an unavailable cost-circuit read", () => {
    const attention = getScannerAttention({
      aiHealth: { state: "healthy", code: null, message: "Validated.", lastSuccessAt: null },
      llmPaused: null,
      failedRuns: 0,
      radarAvailable: true,
      collection: healthyCollection,
    });

    expect(attention.count).toBeNull();
    expect(attention.items.map((item) => item.id)).toEqual(["ai-cost-safety-unavailable"]);
  });

  it("names each unread scanner register once without hiding independent alerts", () => {
    const collection: CollectionHealth = {
      status: "unknown",
      attentionCount: 1,
      lanes: [{ ...healthyCollection.lanes[0], state: "unknown", labelText: "Unknown", needsAttention: false }],
    };
    const attention = getScannerAttention({
      aiHealth: { state: "unavailable", code: "openrouter_budget_exceeded", message: "An AI request exceeded its allowed cost.", lastSuccessAt: null },
      llmPaused: true,
      failedRuns: 0,
      radarAvailable: true,
      scannerReadFailures: ["week", "week", "heartbeat", "awaiting", "published"],
      collection,
    });

    expect(attention.count).toBeNull();
    expect(attention.items.map((item) => item.id)).toEqual([
      "scanner-week-unavailable",
      "scanner-heartbeat-unavailable",
      "scanner-awaiting-unavailable",
      "scanner-published-unavailable",
      "ai-processing",
      "collection-steam",
    ]);
  });
});
