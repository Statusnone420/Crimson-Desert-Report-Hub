import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScannerAiDiagnostics } from "@/components/scanner/ScannerAiDiagnostics";
import { OpenRouterAttemptTrace, upsertOpenRouterAttempt, type OpenRouterTraceJournal } from "@/lib/automation/openRouterTrace";

describe("private scanner AI readout", () => {
  it("uses authoritative cost after older bounded trace entries were omitted", async () => {
    const { scannerAiEvidence } = await import("@/lib/automation/openRouterReadout");
    let journal: OpenRouterTraceJournal | undefined;
    const trace = new OpenRouterAttemptTrace("extraction", 1, (attempt) => { journal = upsertOpenRouterAttempt(journal, attempt); });
    await trace.start(); trace.fetchStarted(20_000); await trace.finish("success", "verified");
    expect(scannerAiEvidence({ llmCostState: "verified", llmSucceeded: 22,
      openRouterTrace: { ...journal, dropped: 21 } }, 22, [])?.costState).toBe("verified");
  });
  it("shows unknown completion and lagging counters without exposing arbitrary progress fields", async () => {
    let journal: OpenRouterTraceJournal | undefined;
    await new OpenRouterAttemptTrace("extraction", 1, (attempt) => { journal = upsertOpenRouterAttempt(journal, attempt); }).start();
    const html = renderToStaticMarkup(createElement(ScannerAiDiagnostics, {
      progress: { llmSucceeded: 0, openRouterTrace: journal, authorization: "PRIVATE-KEY", body: "PRIVATE-PROMPT" }, calls: 0, skips: [],
    }));
    expect(html).toContain("completion not recorded");
    expect(html).toContain("counters can lag");
    expect(html).toContain("provider completion/charge is unverified");
    expect(html).toContain("does not expose separate DNS");
    expect(html).not.toMatch(/PRIVATE-KEY|PRIVATE-PROMPT/);
  });

  it("renders nothing for legacy or invalid records instead of inventing success", () => {
    for (const progress of [null, {}, { openRouterTrace: { version: 1, attempts: ["PRIVATE-RESPONSE"] } }]) {
      expect(renderToStaticMarkup(createElement(ScannerAiDiagnostics, { progress, calls: 0, skips: [] }))).toBe("");
    }
  });

  it("shows a terminal persistence deadline alongside successful, verified AI without raw errors", async () => {
    let journal: OpenRouterTraceJournal | undefined;
    const trace = new OpenRouterAttemptTrace("claim_mapping", 1, (attempt) => { journal = upsertOpenRouterAttempt(journal, attempt); });
    await trace.start(); trace.fetchStarted(20_000); trace.headers(200); trace.body(); await trace.finish("success", "verified");
    const failure = { operationId: trace.id, phase: "terminal", reason: "local_deadline", elapsedMs: 1_003,
      timeoutMs: 1_000, requests: 1, httpStatus: null, databaseCode: null, message: "PRIVATE-ERROR", cause: "PRIVATE-CAUSE" };
    const html = renderToStaticMarkup(createElement(ScannerAiDiagnostics, {
      progress: { llmSucceeded: 1, openRouterTrace: { ...journal, checkpointFailures: 1, checkpointWriteFailures: [failure] } }, calls: 1, skips: [],
    }));
    expect(html).toContain("1 attempted; 1 validated");
    expect(html).toContain("Recorded AI cost verified");
    expect(html).toContain("Failed terminal checkpoint");
    expect(html).toContain("app deadline expired (limit 1000 ms)");
    expect(html).toContain("does not prove that the database rejected or rolled back");
    expect(html).not.toMatch(/PRIVATE-ERROR|PRIVATE-CAUSE|provider completion\/charge is unverified/);
  });
});
