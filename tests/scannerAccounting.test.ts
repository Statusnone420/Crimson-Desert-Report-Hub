import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { admitScannerRun, guardedFinalization, guardedProgress } from "@/lib/automation/accounting.server";
import { computeAutomationBudget } from "@/lib/automation/budget";
import { createScannerBoundedFetch, withScannerExecution } from "@/lib/automation/executionContext.server";
import { persistRunProgress, progressCheckpointEvidence } from "@/lib/automation/runProgress.server";

const budget = () => computeAutomationBudget({ monthlyBudgetUsd: 1, spentMonthToDateUsd: 0, mode: "manual", now: new Date() });
function fixture(respond: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<Response> | Response) {
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  const native = vi.fn<typeof fetch>(async (input, init) => {
    const name = new URL(String(input)).pathname.split("/").at(-1)!;
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ name, args });
    return respond(name, args, init!.signal!);
  });
  const client = createClient("https://fixture.supabase.test", "fixture-key", { global: { fetch: createScannerBoundedFetch(native) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return { client, native, requests };
}
async function admit(client: Parameters<typeof admitScannerRun>[0]) {
  const admission = await admitScannerRun(client, { mode: "manual", budget: budget(), progress: {}, patchBurst: false });
  if (admission.status !== "admitted") throw new Error("Fixture admission failed");
  return admission.run;
}
describe("actual accounting client contract", () => {
  it("replays a lost database acknowledgment with identical identity and never a provider request", async () => {
    let reservations = 0;
    const f = fixture((name) => name === "scanner_admit_run" ? Response.json({ status: "admitted" }) :
      ++reservations === 1 ? Response.json({ code: "fixture_timeout", message: "ambiguous" }, { status: 504 }) : Response.json({ status: "reserved", state: "reserved" }));
    await withScannerExecution(async () => { const run = await admit(f.client); await run.guard.begin("extraction", "immutable-body", 0.01, 0); });
    expect(f.requests).toHaveLength(3);
    expect(f.requests[1]).toEqual(f.requests[2]);
    expect(f.requests[1].args.p_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["42501", "PGRST202"])("does not bypass an admission error %s except the exact missing RPC", async (code) => {
    const f = fixture(() => Response.json({ code, message: "Could not find public.unrelated_function" }, { status: 403 }));
    await expect(withScannerExecution(() => admit(f.client))).rejects.toMatchObject({ code: "reservation_unacknowledged" });
    expect(f.native).toHaveBeenCalledOnce();
  });
  it("supports only the exact missing admission capability without dispatch", async () => {
    const f = fixture(() => Response.json({ code: "PGRST202", message: "Could not find public.scanner_admit_run" }, { status: 404 }));
    expect(await withScannerExecution(() => admitScannerRun(f.client, { mode: "manual", budget: budget(), progress: {}, patchBurst: false }))).toEqual({ status: "unavailable" });
  });
  it("stops after ambiguous settlement and never admits another paid operation", async () => {
    const f = fixture((name) => Response.json(name === "scanner_admit_run" ? { status: "admitted" } : name === "scanner_reserve_operation"
      ? { status: "reserved", state: "reserved" } : { status: "settled", anomalous: false }));
    await withScannerExecution(async () => {
      const run = await admit(f.client);
      const operation = await run.guard.begin("extraction", "body", 0.01, 0);
      await operation.settle({ state: "unknown", llmCostUsd: null, tavilyCredits: null });
      await expect(run.guard.begin("extraction", "next", 0.01, 0)).rejects.toMatchObject({ code: "spending_blocked" });
    });
    expect(f.requests.filter((entry) => entry.name === "scanner_reserve_operation")).toHaveLength(1);
  });
  it("uses the same progress revision on a 504 retry and stops immediately on caller abort", async () => {
    let progress = 0;
    const f = fixture((name) => name === "scanner_admit_run" ? Response.json({ status: "admitted" }) :
      ++progress === 1 ? Response.json({ message: "ambiguous" }, { status: 504 }) : Response.json({ status: "applied" }));
    await withScannerExecution(async () => {
      const run = await admit(f.client);
      await guardedProgress(f.client, run, { progress: { stage: "searching" }, intent: "broad_discovery" }, new AbortController().signal);
      const abort = new AbortController(); abort.abort();
      await expect(guardedProgress(f.client, run, { progress: {}, intent: "broad_discovery" }, abort.signal)).rejects.toThrow();
    });
    expect(f.requests).toHaveLength(3);
    expect(f.requests[1]).toEqual(f.requests[2]);
  });
  it("retains body-phase and size evidence for a stalled database response", async () => {
    const f = fixture((name) => name === "scanner_admit_run" ? Response.json({ status: "admitted" }) :
      new Response(new ReadableStream({ start() {} }), { status: 200 }));
    await withScannerExecution(async () => {
      const run = await admit(f.client);
      try {
        await persistRunProgress(f.client, run.id, { progress: { stage: "searching", searchesDone: 0, searchTotal: 1,
          candidatesSeen: 0, prefilterRejected: 0, llmCallsUsed: 0, kept: 0, promoted: 0 }, intent: "broad_discovery" }, { guardedRun: run, timeoutMs: 20 });
        throw new Error("Expected the response body deadline");
      } catch (error) {
        expect(progressCheckpointEvidence(error)).toMatchObject({ reason: "local_deadline", requestPhase: "body", requests: 1,
          headersAfterMs: expect.any(Number), bodyAfterMs: null, payloadBytes: expect.any(Number) });
      }
    });
  });
  it("replays an immutable finalization with its original key", async () => {
    let finalizations = 0;
    const f = fixture((name) => name === "scanner_admit_run" ? Response.json({ status: "admitted" }) : ++finalizations === 1
      ? Response.json({ message: "ambiguous" }, { status: 504 }) : Response.json({ status: "recorded" }));
    await withScannerExecution(async () => { const run = await admit(f.client); await guardedFinalization(f.client, run, { status: "success" }); });
    expect(f.requests[1]).toEqual(f.requests[2]);
  });
});
