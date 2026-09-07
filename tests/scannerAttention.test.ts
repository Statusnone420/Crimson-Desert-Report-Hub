import { describe, expect, it } from "vitest";
import { getScannerAttention } from "@/lib/scannerAttention";
import type { CollectionHealth } from "@/lib/collectionHealth";

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
});
