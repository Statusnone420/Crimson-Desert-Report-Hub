import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export const SCANNER_WORK_MS = 220_000;
export const SCANNER_TOTAL_MS = 270_000;
export type ScannerIoObservation = { requests: number; headersAfterMs: number | null; bodyAfterMs: number | null; responseBytes: number | null; httpStatus?: number };
type Execution = {
  workDeadlineAtMs: number;
  finalDeadlineAtMs: number;
  phase: "work" | "essential";
  run?: { id: string; token: string };
  io?: ScannerIoObservation;
};
const executions = new AsyncLocalStorage<Execution>();

export function currentScannerExecution(): Execution | undefined { return executions.getStore(); }
export function scannerDeadlineAtMs(): number | undefined {
  const context = executions.getStore();
  return context ? context.phase === "work" ? context.workDeadlineAtMs : context.finalDeadlineAtMs : undefined;
}
export function withScannerExecution<T>(operation: () => T): T {
  if (executions.getStore()) return operation();
  const now = Date.now();
  return executions.run({ workDeadlineAtMs: now + SCANNER_WORK_MS, finalDeadlineAtMs: now + SCANNER_TOTAL_MS, phase: "work" }, operation);
}
export function withScannerRun<T>(run: { id: string; token: string }, operation: () => T): T {
  const context = executions.getStore();
  if (!context) return withScannerExecution(() => withScannerRun(run, operation));
  return executions.run({ ...context, run }, operation);
}
export function withScannerEssential<T>(operation: () => T): T {
  const context = executions.getStore();
  return context ? executions.run({ ...context, phase: "essential" }, operation) : operation();
}
export function withScannerIoObservation<T>(io: ScannerIoObservation, operation: () => T): T {
  const context = executions.getStore();
  return context ? executions.run({ ...context, io }, operation) : operation();
}

/** Bound headers AND body. Read context at dispatch, including cached clients. */
export function createScannerBoundedFetch(nativeFetch: typeof fetch, options: { sourceHeaders?: boolean; maximumMs?: number } = {}): typeof fetch {
  return async (input, init) => {
    const context = executions.getStore();
    if (!context) return nativeFetch(input, init);
    const dispatchedAt = performance.now();
    const io = context.io;
    if (io) { io.requests++; io.headersAfterMs = null; io.bodyAfterMs = null; io.responseBytes = null; io.httpStatus = undefined; }
    const deadline = scannerDeadlineAtMs()!;
    const timeoutMs = Math.min(options.maximumMs ?? (context.phase === "essential" ? 12_000 : 8_000), deadline - Date.now());
    if (timeoutMs <= 0) throw new Error("Scanner execution deadline expired");
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    signal.throwIfAborted();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (options.sourceHeaders !== false && context.phase === "work" && context.run) {
      headers.set("x-scanner-run-id", context.run.id);
      headers.set("x-scanner-execution-token", context.run.token);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Scanner database request timed out");
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        signal.throwIfAborted();
        const response = await nativeFetch(input, { ...init, headers, signal });
        if (io) { io.headersAfterMs = Math.floor(performance.now() - dispatchedAt); io.httpStatus = response.status; }
        const bytes = await response.arrayBuffer();
        if (io) { io.bodyAfterMs = Math.floor(performance.now() - dispatchedAt); io.responseBytes = bytes.byteLength; }
        signal.throwIfAborted();
        return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      })()]);
    } finally { clearTimeout(timer); }
  };
}

export function scannerSourceFetch(): typeof fetch {
  return createScannerBoundedFetch(globalThis.fetch.bind(globalThis), { sourceHeaders: false, maximumMs: 10_000 });
}
