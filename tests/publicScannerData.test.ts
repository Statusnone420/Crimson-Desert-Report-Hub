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

const heartbeatRow = { finished_at: "2026-07-26T12:00:00.000Z", started_at: "2026-07-26T11:58:00.000Z" };

/** One scheduled run inside the week: 3 kept out of a non-zero candidate count. */
const weeklyRunRow = {
  search_results_seen: 10,
  reddit_posts_seen: 0,
  signals_inserted: 3,
  signals_reobserved: 0,
  status: "success",
  mode: "scheduled",
  intent: "broad_sweep",
  search_queries_used: 2,
  funnel: null,
  finished_at: "2026-07-26T12:00:00.000Z",
  started_at: "2026-07-26T11:58:00.000Z",
};

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
  it("loses only the week when the weekly run read fails", async () => {
    resolveQuery = (trace) => {
      if (isWeeklyRunRead(trace)) return { data: null, error: denied };
      if (isHeartbeatRead(trace)) return { data: [heartbeatRow], error: null };
      return { data: [], error: null };
    };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.readFailures).toEqual(["week"]);
    expect(data.scannerConnected).toBe(false);
    // The heartbeat query succeeded, so its answer survives its sibling's failure.
    expect(data.lastCheckedAt).toBe(heartbeatRow.finished_at);
  });

  it("loses only the heartbeat when the heartbeat read fails", async () => {
    resolveQuery = (trace) => {
      if (isHeartbeatRead(trace)) return { data: null, error: denied };
      if (isWeeklyRunRead(trace)) return { data: [weeklyRunRow], error: null };
      return { data: [], error: null };
    };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.readFailures).toEqual(["heartbeat"]);
    expect(data.lastCheckedAt).toBeNull();
    // The whole point of the registers: one missing timestamp no longer takes
    // the week's real counters down with it.
    expect(data.keptThisWeek).toBe(3);
    expect(data.reviewedThisWeek).toBeGreaterThan(0);
  });

  it("loses only awaiting when the approved-report read fails", async () => {
    resolveQuery = (trace) =>
      trace.table === "bug_reports" && trace.columns === "cluster_id, patch_version"
        ? { data: null, error: denied }
        : { data: [], error: null };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.readFailures).toEqual(["awaiting"]);
  });

  it("fails both registers that depend on the public-signal read", async () => {
    resolveQuery = (trace) =>
      trace.table === "source_signals" && trace.operations.includes("eq:public_status:public")
        ? { data: null, error: denied }
        : { data: [], error: null };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    // One query, two registers: public signals feed both the awaiting split and
    // the issue board the published count is taken from. The week and heartbeat
    // registers do not touch it and survive.
    expect(data.readFailures).toEqual(["awaiting", "published"]);
    expect(data.scannerConnected).toBe(false);
  });

  it("marks published unavailable when the issue-board read degrades to empty", async () => {
    // The board read returns empty rather than throwing on a query error, so an
    // exception is not the only way this count can be wrong.
    resolveQuery = (trace) =>
      trace.table === "issue_clusters" ? { data: null, error: denied } : { data: [], error: null };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.readFailures).toContain("published");
    expect(data.published).toBe(0);
  });

  it("marks every register unavailable when the whole read collapses", async () => {
    mocks.getAutomationControlState.mockRejectedValue(new Error("settings unavailable"));
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    // A total outage still degrades the coarse way — the registers are for
    // partial failures, not a replacement for the all-down case.
    expect(data.readFailures).toEqual(["week", "heartbeat", "awaiting", "published"]);
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

  it("still evaluates the circuit after an unrelated register fails", async () => {
    resolveQuery = (trace) => {
      if (isWeeklyRunRead(trace)) return { data: null, error: denied };
      if (isCircuitRead(trace)) return { data: [openCircuitRow], error: null };
      return { data: [], error: null };
    };
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    // The weekly failure no longer aborts the function, so the circuit gets a
    // real answer rather than an unknown inherited from an unrelated query.
    expect(data.llmPaused).toBe(true);
    expect(data.readFailures).toEqual(["week"]);
  });

  it("reports the circuit unknown when the circuit read itself fails", async () => {
    // The tri-state has to cover this read too, not only failures before it —
    // otherwise a permission error on exactly this query still renders "Paused".
    resolveQuery = (trace) => (isCircuitRead(trace) ? { data: null, error: denied } : { data: [], error: null });
    const { getPublicScannerData } = await import("@/lib/queries");

    const data = await getPublicScannerData();

    expect(data.scannerConnected).toBe(true);
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
