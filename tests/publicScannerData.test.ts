import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getAutomationControlState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// Pass-through cache so the uncached body under test actually runs.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from }),
  hasSupabaseServiceConfig: () => true,
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: mocks.getAutomationControlState,
}));

type QueryTrace = { table: string; columns: string; operations: string[] };
type QueryResult = { data: unknown[] | null; error: Record<string, unknown> | null };

let resolveQuery: (trace: QueryTrace) => QueryResult;

class FakeQuery {
  private readonly trace: QueryTrace;

  constructor(table: string) {
    this.trace = { table, columns: "", operations: [] };
  }

  select(columns = "") {
    this.trace.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.trace.operations.push(`eq:${column}:${String(value)}`);
    return this;
  }

  neq(column: string, value: unknown) {
    this.trace.operations.push(`neq:${column}:${String(value)}`);
    return this;
  }

  gt(column: string) {
    this.trace.operations.push(`gt:${column}`);
    return this;
  }

  gte(column: string) {
    this.trace.operations.push(`gte:${column}`);
    return this;
  }

  is(column: string, value: unknown) {
    this.trace.operations.push(`is:${column}:${String(value)}`);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.trace.operations.push(`in:${column}:${values.join("|")}`);
    return this;
  }

  not(column: string, operator: string) {
    this.trace.operations.push(`not:${column}:${operator}`);
    return this;
  }

  or(expression: string) {
    this.trace.operations.push(`or:${expression}`);
    return this;
  }

  order(column: string) {
    this.trace.operations.push(`order:${column}`);
    return this;
  }

  limit(count: number) {
    this.trace.operations.push(`limit:${count}`);
    return this;
  }

  range(from: number, to: number) {
    this.trace.operations.push(`range:${from}:${to}`);
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(resolveQuery(this.trace)).then(onfulfilled, onrejected);
  }
}

const denied = { code: "42501", message: "permission denied" };

/** The weekly intake read: automation_runs, filtered to the last seven days. */
function isWeeklyRunRead(trace: QueryTrace): boolean {
  return trace.table === "automation_runs" && trace.columns.includes("search_results_seen");
}

/** The heartbeat read: newest terminal run, finished_at/started_at only. */
function isHeartbeatRead(trace: QueryTrace): boolean {
  return trace.table === "automation_runs" && trace.columns === "finished_at, started_at";
}

/** The cost-safety circuit read, shared with the automation engine. */
function isCircuitRead(trace: QueryTrace): boolean {
  return trace.table === "automation_runs" && trace.columns === "skips, started_at";
}

const openCircuitRow = { skips: ["openrouter_unexpected_charge"], started_at: new Date().toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  resolveQuery = () => ({ data: [], error: null });
  mocks.from.mockImplementation((table: string) => new FakeQuery(table));
  mocks.getAutomationControlState.mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
  });
});

describe("getPublicScannerData read failures", () => {
  it("reports the scanner disconnected when the weekly run read fails", async () => {
    resolveQuery = (trace) => (isWeeklyRunRead(trace) ? { data: null, error: denied } : { data: [], error: null });
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.scannerConnected).toBe(false);
    expect(data.scannerActive).toBe(false);
  });

  it("reports the scanner disconnected when the heartbeat read fails", async () => {
    resolveQuery = (trace) => (isHeartbeatRead(trace) ? { data: null, error: denied } : { data: [], error: null });
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.scannerConnected).toBe(false);
    expect(data.lastCheckedAt).toBeNull();
  });

  it("reports the scanner disconnected when the approved-report read fails", async () => {
    resolveQuery = (trace) =>
      trace.table === "bug_reports" && trace.columns === "cluster_id, patch_version"
        ? { data: null, error: denied }
        : { data: [], error: null };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.scannerConnected).toBe(false);
  });

  it("keeps an open cost circuit open when a later read throws", async () => {
    resolveQuery = (trace) => {
      if (isCircuitRead(trace)) return { data: [openCircuitRow], error: null };
      return { data: [], error: null };
    };
    // Reached only after the circuit has been evaluated, so this is the case
    // where a real "paused" answer exists and must not be thrown away.
    mocks.getAutomationControlState.mockRejectedValue(new Error("settings unavailable"));
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.scannerConnected).toBe(false);
    expect(data.llmPaused).toBe(true);
  });

  it("reports the circuit unknown when the failure lands before it can be evaluated", async () => {
    resolveQuery = (trace) => (isWeeklyRunRead(trace) ? { data: null, error: denied } : { data: [], error: null });
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    // Not `true`: the engine fails closed because it is deciding whether to
    // spend, but this value is only displayed, and "we could not read it" is a
    // different claim from "the circuit is open".
    expect(data.llmPaused).toBeNull();
  });

  it("reports the scanner disconnected when the public-signal cluster read fails", async () => {
    resolveQuery = (trace) =>
      trace.table === "source_signals" && trace.operations.includes("eq:public_status:public")
        ? { data: null, error: denied }
        : { data: [], error: null };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    // An empty set would have made every private-lead cluster look
    // uncorroborated, inflating "awaiting" rather than zeroing it.
    expect(data.scannerConnected).toBe(false);
  });
});
