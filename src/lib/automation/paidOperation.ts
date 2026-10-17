/** Essential accounting is separate from best-effort attempt telemetry. */
export type PaidOperationKind = "extraction" | "claim_mapping" | "tavily_search" | "tavily_extract";
export type PaidSettlement = {
  state: "verified" | "estimated" | "unknown" | "not_sent";
  llmCostUsd: number | null;
  tavilyCredits: number | null;
};
export type PaidOperation = { settle(value: PaidSettlement): Promise<void> };
export type PaidOperationGuard = {
  readonly blockedReason?: ScannerAccountingError["code"];
  deadlineAtMs: number;
  begin(kind: PaidOperationKind, requestBody: string, llmCeilingUsd: number, tavilyCeiling: number): Promise<PaidOperation>;
};

export class ScannerAccountingError extends Error {
  constructor(readonly code: "accounting_unavailable" | "reservation_unacknowledged" | "settlement_unacknowledged" | "spending_blocked", cause?: unknown) {
    super(`Scanner paid work stopped: ${code}`, { cause });
    this.name = "ScannerAccountingError";
  }
}

export async function paidProviderRequest<T>(guard: PaidOperationGuard | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeoutMs = Math.min(20_000, guard ? guard.deadlineAtMs - Date.now() : 20_000);
  if (timeoutMs <= 0) throw new Error("Scanner source deadline expired");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const error = new Error("Scanner source request timed out"); controller.abort(error); reject(error); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
