import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase";
import type { AutomationBudget } from "./budget";
import { currentScannerExecution, withScannerEssential } from "./executionContext.server";
import { ScannerAccountingError, type PaidOperationGuard } from "./paidOperation";

type Client = ReturnType<typeof createServiceClient>;
export type GuardedRun = { id: string; token: string; revision: number; finalizationKey: string; guard: PaidOperationGuard };
export type Admission = { status: "admitted"; run: GuardedRun } | { status: "already_running" | "paused" | "recent_run" } | { status: "unavailable" };

/** Only the exact absent RPC is a rolling-deploy compatibility condition. */
export function missingScannerRpc(error: unknown, name: string): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return value.code === "PGRST202" && typeof value.message === "string" &&
    value.message.includes(`public.${name}`);
}

async function accountingRpc(client: Client, name: string, args: Record<string, unknown>, signal?: AbortSignal, onRequest?: () => void): Promise<Record<string, unknown>> {
  const operation = async () => {
    // Replays only this immutable database request. Never replays a provider.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      onRequest?.();
      const query = client.rpc(name, args);
      const response = await (signal ? query.abortSignal(signal) : query);
      signal?.throwIfAborted();
      if (!response.error && response.data && typeof response.data === "object") return { ...response.data as Record<string, unknown>, httpStatus: response.status };
      if (attempt === 0 && (response.status === 504 || response.status === 0)) continue;
      throw { ...response.error, status: response.status, message: response.error?.message ?? "Scanner accounting acknowledgment missing" };
    }
    throw new Error("Scanner accounting acknowledgment missing");
  };
  return signal ? operation() : withScannerEssential(operation);
}

export async function admitScannerRun(client: Client, input: {
  mode: string; budget: AutomationBudget; progress: unknown; patchBurst: boolean; attemptId?: string; now?: Date;
}): Promise<Admission> {
  const context = currentScannerExecution();
  if (!context) throw new Error("Scanner execution context missing");
  const id = input.attemptId ?? randomUUID();
  const token = randomUUID();
  let data: Record<string, unknown>;
  try {
    data = await accountingRpc(client, "scanner_admit_run", {
      p_run_id: id, p_token: token, p_mode: input.mode,
      p_work_deadline: new Date(context.workDeadlineAtMs).toISOString(),
      p_lease_deadline: new Date(context.finalDeadlineAtMs).toISOString(),
      p_budget: input.budget, p_progress: input.progress, p_patch_burst: input.patchBurst,
    });
  } catch (error) {
    if (missingScannerRpc(error, "scanner_admit_run")) return { status: "unavailable" };
    throw new ScannerAccountingError("reservation_unacknowledged", error);
  }
  if (data.status === "already_running" || data.status === "paused" || data.status === "recent_run") return { status: data.status };
  if (data.status !== "admitted") throw new ScannerAccountingError("reservation_unacknowledged");
  let stopped = false;
  const guard: PaidOperationGuard = {
    get blockedReason() { return stopped ? "spending_blocked" as const : undefined; },
    deadlineAtMs: context.workDeadlineAtMs,
    async begin(kind, body, llmCeilingUsd, tavilyCeiling) {
      if (stopped || Date.now() >= context.workDeadlineAtMs - 5_000) throw new ScannerAccountingError("spending_blocked");
      const operationId = randomUUID();
      const fingerprint = createHash("sha256").update(body).digest("hex");
      try {
        const reserve = await accountingRpc(client, "scanner_reserve_operation", {
          p_run_id: id, p_token: token, p_operation_id: operationId,
          p_kind: kind, p_fingerprint: fingerprint, p_llm_usd: llmCeilingUsd, p_tavily_credits: tavilyCeiling,
        });
        if (reserve.status !== "reserved" || reserve.state !== "reserved") throw new Error("Reservation cannot dispatch");
      } catch (error) {
        stopped = true;
        if (error && typeof error === "object" && ["scanner_spending_blocked", "scanner_execution_closed"].includes(String((error as { message?: string }).message))) {
          throw new ScannerAccountingError("spending_blocked", error);
        }
        throw new ScannerAccountingError("reservation_unacknowledged", error);
      }
      return { async settle(value) {
        try {
          const settled = await accountingRpc(client, "scanner_settle_operation", {
            p_run_id: id, p_token: token, p_operation_id: operationId,
            p_state: value.state, p_llm_usd: value.llmCostUsd, p_tavily_credits: value.tavilyCredits, p_revision: 1,
          });
          if (settled.status !== "settled") throw new Error("Settlement acknowledgment missing");
          if (settled.anomalous || value.state === "unknown") stopped = true;
        } catch (error) {
          stopped = true;
          console.error(JSON.stringify({ event: "scanner_accounting_failure", id, stage: "settlement",
            providerCostKnown: value.state === "verified", ledgerAcknowledged: false }));
          throw new ScannerAccountingError("settlement_unacknowledged", error);
        }
      } };
    },
  };
  return { status: "admitted", run: { id, token, revision: 0, finalizationKey: randomUUID(), guard } };
}

export function guardedProgress(client: Client, run: GuardedRun, payload: { progress: unknown; intent: string }, signal: AbortSignal, onRequest?: () => void) {
  const revision = ++run.revision;
  return accountingRpc(client, "scanner_write_progress", { p_run_id: run.id, p_token: run.token,
    p_revision: revision, p_progress: structuredClone(payload.progress), p_intent: payload.intent }, signal, onRequest);
}
export function guardedFinalization(client: Client, run: GuardedRun, payload: Record<string, unknown>) {
  return accountingRpc(client, "scanner_finalize_run", { p_run_id: run.id, p_token: run.token,
    p_key: run.finalizationKey, p_result: structuredClone(payload) });
}
