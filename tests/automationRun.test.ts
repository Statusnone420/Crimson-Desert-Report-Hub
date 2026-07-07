import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractSignalWithOpenRouter: vi.fn(),
  fetchNewPosts: vi.fn(),
  from: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
  getRedditToken: vi.fn(),
  getAutomationControlState: vi.fn(),
  runAutomationMonitor: vi.fn(),
  insertSkippedScheduledRun: vi.fn(),
  syncOfficialPatchNote: vi.fn(),
  tavilySearch: vi.fn(),
  tavilyExtract: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/reddit.server", () => ({
  fetchNewPosts: mocks.fetchNewPosts,
  getRedditToken: mocks.getRedditToken,
}));

vi.mock("@/lib/automation/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/search")>();
  return {
    ...actual,
    tavilySearch: mocks.tavilySearch,
    tavilyExtract: mocks.tavilyExtract,
  };
});

vi.mock("@/lib/automation/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/extract")>();
  return {
    ...actual,
    extractSignalWithOpenRouter: mocks.extractSignalWithOpenRouter,
  };
});

vi.mock("@/lib/officialPatch.server", () => ({
  CURRENT_PATCH_TAG: "current-patch",
  PUBLIC_DASHBOARD_TAG: "public-dashboard",
  PUBLIC_ISSUES_TAG: "public-issues",
  getCurrentPatchMetadata: mocks.getCurrentPatchMetadata,
  syncOfficialPatchNote: mocks.syncOfficialPatchNote,
}));

type Row = Record<string, unknown>;
type TableName =
  | "automation_runs"
  | "automation_rejected_candidates"
  | "official_patch_notes"
  | "source_signals"
  | "issue_clusters"
  | "bug_reports"
  | "approved_excerpts"
  | "automation_settings";
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "is"; column: string; value: unknown }
  | { type: "gte"; column: string; value: unknown }
  | { type: "gt"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "not"; column: string; operator: string; value: unknown };

const tables: Record<TableName, Row[]> = {
  automation_runs: [],
  automation_rejected_candidates: [],
  official_patch_notes: [],
  source_signals: [],
  issue_clusters: [],
  bug_reports: [],
  approved_excerpts: [],
  automation_settings: [],
};
const mutations: { table: TableName; type: "insert" | "update" | "upsert" | "delete"; row: unknown }[] = [];
let idSeq = 1;
let openRouterAttempts = 0;
let selectFailure: { table: TableName; message: string; columns?: string } | null = null;
let updateFailure: { table: TableName; message: string } | null = null;
let deleteFailure: { table: TableName; message: string } | null = null;

const officialPatchFixture = {
  version: "1.13.00",
  title: "Patch Notes Version 1.13.00",
  officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
  publishedAt: "2026-07-03T03:00:00.000Z",
  summary: "Official test patch metadata.",
  source: "official" as const,
};

function resetDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  for (const table of Object.keys(tables) as TableName[]) {
    tables[table] = seed[table]?.map((row) => ({ ...row })) ?? [];
  }
  mutations.length = 0;
  idSeq = 1;
  openRouterAttempts = 0;
  selectFailure = null;
  updateFailure = null;
  deleteFailure = null;
}

function nextId(table: TableName) {
  return `${table}-${idSeq++}`;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function passesFilter(row: Row, filter: Filter): boolean {
  const value = row[filter.column];
  if (filter.type === "eq") return value === filter.value;
  if (filter.type === "is" && filter.value === null) return value == null;
  if (filter.type === "is") return value === filter.value;
  if (filter.type === "in") return filter.value.includes(value);
  if (filter.type === "gte") return String(value) >= String(filter.value);
  if (filter.type === "gt") return String(value) > String(filter.value);
  if (filter.type === "lt") return String(value) < String(filter.value);
  if (filter.type === "not" && filter.operator === "is" && filter.value === null) return value !== null;
  if (filter.type === "not" && filter.operator === "like") return !likeToRegExp(String(filter.value)).test(String(value ?? ""));
  throw new Error(`unsupported filter ${filter.type}`);
}

class FakeQuery {
  private filters: Filter[] = [];
  private insertRows: Row[] | null = null;
  private isDelete = false;
  private limitCount: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private patch: Row | null = null;
  private rangeBounds: { from: number; to: number } | null = null;
  private selectedColumns: string | undefined;
  private selectOptions: { count?: "exact"; head?: boolean } | undefined;
  private singleResult = false;
  private upsertRows: Row[] | null = null;
  private upsertConflict = "id";

  constructor(private readonly table: TableName) {}

  select(columns?: string, options?: { count?: "exact"; head?: boolean }) {
    this.selectedColumns = columns;
    this.selectOptions = options;
    return this;
  }

  insert(row: Row | Row[]) {
    this.insertRows = Array.isArray(row) ? row : [row];
    return this;
  }

  update(patch: Row) {
    this.patch = patch;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  upsert(row: Row | Row[], options?: { onConflict?: string }) {
    this.upsertRows = Array.isArray(row) ? row : [row];
    this.upsertConflict = options?.onConflict ?? "id";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ type: "gt", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.filters.push({ type: "not", column, operator, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = { from, to };
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    if (this.insertRows) return this.executeInsert();
    if (this.upsertRows) return this.executeUpsert();
    if (this.isDelete) return this.executeDelete();
    if (this.patch) return this.executeUpdate();
    return this.executeSelect();
  }

  private executeDelete() {
    if (deleteFailure?.table === this.table) {
      return { data: null, error: { message: deleteFailure.message } };
    }
    const matching = this.filteredRows();
    tables[this.table] = tables[this.table].filter((row) => !matching.includes(row));
    mutations.push({ table: this.table, type: "delete", row: { filters: this.filters } });
    return { data: matching, error: null };
  }

  private executeInsert() {
    const inserted = this.insertRows!.map((row) => {
      const next = {
        id: row.id ?? nextId(this.table),
        created_at: row.created_at ?? "2026-07-05T12:00:00.000Z",
        started_at: this.table === "automation_runs" ? (row.started_at ?? "2026-07-05T12:00:00.000Z") : row.started_at,
        ...row,
      };
      tables[this.table].push(next);
      // Snapshot at insert time: `next` is also the live row in `tables`, and later
      // updates mutate it in place, so the mutation log would otherwise reflect the
      // row's final state instead of what was actually inserted.
      mutations.push({ table: this.table, type: "insert", row: { ...next } });
      return next;
    });
    return { data: this.singleResult ? inserted[0] : inserted, error: null };
  }

  private executeUpsert() {
    const rows = this.upsertRows!.map((row) => {
      const existing = tables[this.table].find((item) => item[this.upsertConflict] === row[this.upsertConflict]);
      if (existing) {
        Object.assign(existing, row);
        mutations.push({ table: this.table, type: "upsert", row: { ...existing } });
        return existing;
      }

      const inserted = { id: row.id ?? nextId(this.table), created_at: "2026-07-05T12:00:00.000Z", ...row };
      tables[this.table].push(inserted);
      mutations.push({ table: this.table, type: "upsert", row: inserted });
      return inserted;
    });
    return { data: this.singleResult ? rows[0] : rows, error: null };
  }

  private executeUpdate() {
    if (updateFailure?.table === this.table) {
      return { data: null, error: { message: updateFailure.message } };
    }
    const rows = this.filteredRows();
    for (const row of rows) Object.assign(row, this.patch);
    mutations.push({ table: this.table, type: "update", row: this.patch });
    return { data: rows, error: null };
  }

  private executeSelect() {
    // A failure with `columns` set targets only queries whose select string
    // contains it (e.g. loadMonthSpend's "estimated_cost_usd"). Substring match,
    // not equality, so adding a column to the production select can't silently
    // turn the injection into a no-op. Without `columns`, every select on the
    // table fails.
    if (
      selectFailure?.table === this.table &&
      (!selectFailure.columns || (this.selectedColumns ?? "").includes(selectFailure.columns))
    ) {
      return { data: null, count: null, error: { message: selectFailure.message } };
    }
    let rows = this.filteredRows().map((row) => ({ ...row }));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = rows.sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    if (this.rangeBounds !== null) rows = rows.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    if (this.selectOptions?.head) return { data: null, count: rows.length, error: null };
    return { data: this.singleResult ? (rows[0] ?? null) : rows, count: this.selectOptions?.count ? rows.length : null, error: null };
  }

  private filteredRows() {
    return tables[this.table].filter((row) => this.filters.every((filter) => passesFilter(row, filter)));
  }
}

function sourceSignalRows() {
  return tables.source_signals;
}

function rejectedCandidateRows() {
  return tables.automation_rejected_candidates;
}

async function importRunner() {
  vi.doUnmock("@/lib/automation/run");
  vi.resetModules();
  return import("@/lib/automation/run");
}

function configureProviders() {
  mocks.from.mockImplementation((table: TableName) => new FakeQuery(table));
  mocks.getCurrentPatchMetadata.mockResolvedValue(officialPatchFixture);
  mocks.syncOfficialPatchNote.mockResolvedValue({ status: "synced", changed: false, patch: officialPatchFixture });
  mocks.getRedditToken.mockResolvedValue("reddit-token");
  mocks.fetchNewPosts.mockResolvedValue([
    {
      id: "reddit-fps",
      title: "FPS drops since 1.13",
      selftext: "Steam users are seeing stutter.",
      permalink: "/r/CrimsonDesert/comments/reddit-fps/fps/",
      created_utc: 1783260000,
    },
  ]);
  mocks.tavilySearch.mockResolvedValue([
    {
      title: "Crimson Desert patch 1.13 FPS regression",
      url: "https://example.com/fps",
      snippet: "Players report FPS drops on Steam.",
      sourceDomain: "example.com",
      observedAt: "2026-07-05T12:00:00.000Z",
    },
  ]);
  // Recon is off by default: no full-page text unless a test opts in. Existing
  // borderline behavior (extract on the thin snippet) must be unchanged.
  mocks.tavilyExtract.mockResolvedValue(null);
  mocks.extractSignalWithOpenRouter.mockImplementation(async (candidate, options) => {
    const text = `${candidate.title} ${candidate.snippet}`;
    const isCrash = /map crash/i.test(text);
    const canUseOpenRouter = options.llmCallsRemaining > 0 && process.env.OPENROUTER_API_KEY;
    if (canUseOpenRouter) openRouterAttempts += 1;

    return {
      issueTitle: isCrash ? "Map crash on PS5" : "FPS regression since 1.13",
      category: isCrash ? "crash_startup" : "performance",
      platform: isCrash ? "ps5" : "pc_steam",
      confidence: canUseOpenRouter ? "high" : "medium",
      summary: isCrash ? "Map crash on PS5." : "Players report FPS drops on Steam.",
      extractionProvider: canUseOpenRouter ? "openrouter" : "deterministic",
      extractionModel: canUseOpenRouter ? process.env.OPENROUTER_FREE_MODEL : null,
      llmCallsUsed: canUseOpenRouter ? 1 : 0,
      llmCostUsd: canUseOpenRouter ? 0.0002 : 0,
    };
  });
  mocks.getAutomationControlState.mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 900,
    monthlyLlmUsdCap: 1,
    modelPreset: "deepseek_qwen_pro",
    updatedAt: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
  configureProviders();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.REDDIT_CLIENT_ID = "reddit-id";
  process.env.REDDIT_CLIENT_SECRET = "reddit-secret";
  process.env.REDDIT_USER_AGENT = "report-hub-test";
  process.env.TAVILY_API_KEY = "tavily-key";
  process.env.AUTOMATION_BUDGET_USD_MONTHLY = "5";
  process.env.OPENROUTER_API_KEY = "openrouter-key";
  process.env.OPENROUTER_FREE_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
  delete process.env.CRON_SECRET;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/automation/run");
});

describe("runAutomationMonitor", () => {
  it("dry run writes only an automation_runs ledger row", async () => {
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "dry_run", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.redditPostsSeen).toBe(1);
    expect(result.searchResultsSeen).toBe(5);
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      mode: "dry_run",
      signals_inserted: 2,
      search_results_seen: 5,
      llm_calls_used: 2,
    });
    expect(sourceSignalRows()).toHaveLength(0);
    expect(tables.issue_clusters).toHaveLength(0);
    expect(mutations.filter((mutation) => mutation.table !== "automation_runs")).toHaveLength(0);
    expect(mocks.syncOfficialPatchNote).not.toHaveBeenCalled();
  });

  it("uses the official current patch version when planning source searches", async () => {
    const patch = { ...officialPatchFixture, version: "1.14.00", title: "Patch Notes Version 1.14.00" };
    mocks.getCurrentPatchMetadata.mockResolvedValue(patch);
    mocks.syncOfficialPatchNote.mockResolvedValue({ status: "synced", changed: true, patch });
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.tavilySearch).toHaveBeenCalled();
    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("patch 1.14.00");
  });

  it("rotates one-credit scheduled web search across adjacent hourly scans", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
        modelPreset: "deepseek_qwen_pro",
      },
    });
    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T13:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).toBe("Crimson Desert patch 1.13.00 FPS drops stutter issue");
    expect(mocks.tavilySearch.mock.calls[1][0]).toBe(
      "site:reddit.com Crimson Desert patch 1.13.00 crash freeze stutter issue",
    );
  });

  it("budget 0 skips paid search and OpenRouter attempts but still stores deterministic Reddit signals", async () => {
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "0";
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).toContain("budget_zero");
    expect(result.searchQueriesUsed).toBe(0);
    expect(result.searchResultsSeen).toBe(0);
    expect(result.llmCallsUsed).toBe(0);
    expect(openRouterAttempts).toBe(0);
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      source: "reddit",
      extraction_provider: "deterministic",
      extraction_model: null,
      public_status: "private",
    });
  });

  it("scheduled runs with an exhausted Tavily credit cap write a skipped ledger row without providers", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-used-credit",
          started_at: "2026-07-01T12:00:00.000Z",
          estimated_cost_usd: 0.008,
          search_queries_used: 1,
          mode: "scheduled",
          status: "success",
        },
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1,
        monthlyLlmUsdCap: 1,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.skips).toContain("tavily_credit_cap");
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs).toHaveLength(2);
    expect(tables.automation_runs[1]).toMatchObject({
      status: "skipped",
      mode: "scheduled",
      skips: expect.arrayContaining(["tavily_credit_cap"]),
    });
  });

  it("scheduled runs with an exhausted LLM cap write a skipped ledger row without providers", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-used-llm",
          started_at: "2026-07-01T12:00:00.000Z",
          estimated_cost_usd: 1.008,
          search_queries_used: 1,
          mode: "scheduled",
          status: "success",
        },
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.skips).toContain("llm_budget_capped");
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs[1]).toMatchObject({
      status: "skipped",
      mode: "scheduled",
      skips: expect.arrayContaining(["llm_budget_capped"]),
    });
  });

  it("fails closed when the automation_runs ledger cannot be read for the active-run check", async () => {
    // The active-run pre-flight check reads automation_runs before any ledger row
    // exists for this attempt, so a broadly unreadable ledger table must abort
    // before touching Reddit/search/LLM providers, with zero ledger rows written.
    selectFailure = { table: "automation_runs", message: "ledger unavailable" };
    const { runAutomationMonitor } = await importRunner();

    await expect(runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") })).rejects.toThrow(
      "ledger unavailable",
    );

    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs).toHaveLength(0);
    expect(mutations.filter((mutation) => mutation.type === "insert")).toHaveLength(0);
  });

  it("skips the run but still writes and finalizes a ledger row when only the month spend read fails", async () => {
    // Fail ONLY loadMonthSpend's select (estimated_cost_usd); hasActiveRun's
    // select (id) succeeds, so the run starts, creates a running ledger row,
    // and finalizes it as skipped with the budget read error recorded.
    selectFailure = { table: "automation_runs", columns: "estimated_cost_usd", message: "spend ledger unavailable" };
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("skipped");
    expect(result.skips).toContain("budget_read_failed");
    expect(result.errors[0]).toContain("spend ledger unavailable");
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);

    const insertMutation = mutations.find((mutation) => mutation.table === "automation_runs" && mutation.type === "insert");
    expect(insertMutation).toBeDefined();
    expect(insertMutation!.row).toMatchObject({ status: "running" });

    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      status: "skipped",
      skips: expect.arrayContaining(["budget_read_failed"]),
      errors: [expect.stringContaining("spend ledger unavailable")],
    });
    expect(tables.automation_runs[0].finished_at).toBeTruthy();
    expect(mutations.filter((mutation) => mutation.type === "insert" && mutation.table !== "automation_runs")).toHaveLength(0);
  });

  it("non-dry runs cluster two independent trusted+unknown domains and promote them public", async () => {
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-fps",
        title: "FPS drops since 1.13",
        selftext: "Steam users are seeing stutter.",
        permalink: "/r/CrimsonDesert/comments/reddit-fps/fps/",
        created_utc: Math.floor(new Date("2026-07-05T11:00:00.000Z").getTime() / 1000),
      },
    ]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(2);
    expect(result.llmCallsUsed).toBe(2);
    expect(result.clustersPromoted).toBe(1);
    expect(tables.issue_clusters).toHaveLength(1);
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      direct_report_count: 0,
      verified_report_count: 0,
      public_signal_count: 2,
      auto_public: true,
      is_public: true,
    });
    expect(new Set(sourceSignalRows().map((row) => row.cluster_id))).toEqual(new Set([tables.issue_clusters[0].id]));
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["public", "public"]);
    expect(sourceSignalRows().map((row) => row.promotion_reason)).toEqual([
      "two_independent_domains_trusted",
      "two_independent_domains_trusted",
    ]);
    expect(sourceSignalRows()[0]).toMatchObject({
      extraction_provider: "openrouter",
      extraction_model: "meta-llama/llama-3.3-70b-instruct:free",
    });
  });

  it("direct approved reports promote a matching one-source signal", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Existing approved player report.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-map",
          category: "crash_startup",
          platform: "ps5",
          issue_title: "Map crash on PS5",
          moderation_status: "approved",
          cluster_id: "cluster-map",
        },
      ],
    });
    configureProviders();
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-map",
        title: "Map crash on PS5",
        selftext: "Map crash still happens on PS5.",
        permalink: "/r/CrimsonDesert/comments/reddit-map/map/",
        created_utc: 1783260000,
      },
    ]);
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(result.clustersPromoted).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-map",
      public_status: "public",
      promotion_reason: "direct_report_match",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      direct_report_count: 1,
      signal_count: 1,
      public_signal_count: 1,
      auto_public: true,
      is_public: true,
    });
  });

  it("keeps an untrusted single-domain signal private under a direct-report cluster while the cluster stays public", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Existing approved player report.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-map",
          category: "crash_startup",
          platform: "ps5",
          issue_title: "Map crash on PS5",
          moderation_status: "approved",
          cluster_id: "cluster-map",
        },
      ],
    });
    configureProviders();
    // No reddit posts: the only signal is a lone, untrusted (facebook.com),
    // single-domain web result. It is fresh (published after the current patch)
    // so it is publishable, and it clusters onto the approved-report cluster.
    mocks.fetchNewPosts.mockResolvedValue([]);
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Map crash on PS5",
        url: "https://facebook.com/groups/crimsondesert/posts/map-crash",
        snippet: "The map crash still happens on PS5 after loading.",
        sourceDomain: "facebook.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-04T10:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()).toHaveLength(1);
    // The untrusted, uncorroborated signal must NOT ride the cluster's direct
    // report onto the public board — it stays private / below_threshold.
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-map",
      source_domain: "facebook.com",
      public_status: "private",
      promotion_reason: "below_threshold",
    });
    // The cluster itself is still public thanks to the approved report, but no
    // scanner signal counts as standalone public evidence.
    expect(tables.issue_clusters[0]).toMatchObject({
      direct_report_count: 1,
      signal_count: 1,
      public_signal_count: 0,
      auto_public: true,
      is_public: true,
    });
  });

  it("promotes a trusted (reddit.com) direct-report signal to public even without domain corroboration", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Existing approved player report.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-map",
          category: "crash_startup",
          platform: "ps5",
          issue_title: "Map crash on PS5",
          moderation_status: "approved",
          cluster_id: "cluster-map",
        },
      ],
    });
    configureProviders();
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-map",
        title: "Map crash on PS5",
        selftext: "Map crash still happens on PS5.",
        permalink: "/r/CrimsonDesert/comments/reddit-map/map/",
        created_utc: 1783260000,
      },
    ]);
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-map",
      source_domain: "reddit.com",
      public_status: "public",
      promotion_reason: "direct_report_match",
    });
    expect(tables.issue_clusters[0]).toMatchObject({ public_signal_count: 1, is_public: true });
  });

  it("counts duplicate approved excerpts as one verified report per report", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Existing approved player report.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-map",
          category: "crash_startup",
          platform: "ps5",
          issue_title: "Map crash on PS5",
          moderation_status: "approved",
          cluster_id: "cluster-map",
        },
      ],
      approved_excerpts: [
        { id: "excerpt-one", report_id: "report-map" },
        { id: "excerpt-two", report_id: "report-map" },
      ],
    });
    configureProviders();
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-map",
        title: "Map crash on PS5",
        selftext: "Map crash still happens on PS5.",
        permalink: "/r/CrimsonDesert/comments/reddit-map/map/",
        created_utc: 1783260000,
      },
    ]);
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      verified_report_count: 1,
    });
  });

  it("does not promote two fresh distinct canonical URLs on the same domain (not independent)", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.OPENROUTER_API_KEY;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://same.example/fps-one",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "same.example",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://same.example/fps-two",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "same.example",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(2);
    expect(result.clustersPromoted).toBe(0);
    expect(sourceSignalRows()).toHaveLength(2);
    expect(new Set(sourceSignalRows().map((row) => row.canonical_url))).toEqual(
      new Set(["https://same.example/fps-one", "https://same.example/fps-two"]),
    );
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["private", "private"]);
    expect(sourceSignalRows().map((row) => row.promotion_reason)).toEqual(["below_threshold", "below_threshold"]);
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 0,
      auto_public: false,
    });
  });

  it("filters broad reviews and patch notes before writing source signals", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/patch-notes",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T10:00:00.000Z",
      },
      {
        title: "Crimson Desert PS5 Review",
        url: "https://www.youtube.com/watch?v=review",
        snippet: "A general review of the game on PlayStation 5.",
        sourceDomain: "youtube.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 FPS drops",
        url: "https://example.com/fps-drops",
        snippet: "Players report FPS drops and stutter on Steam after the patch.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.extractSignalWithOpenRouter.mockImplementation(async (candidate) => {
      if (/patch notes/i.test(candidate.title)) {
        return {
          issueTitle: "Patch notes",
          category: "other",
          platform: null,
          confidence: "low",
          summary: "No reported issues.",
          extractionProvider: "openrouter",
          extractionModel: "openrouter/free",
          llmCallsUsed: 1,
          llmCostUsd: 0,
        };
      }
      if (/review/i.test(candidate.title)) {
        return {
          issueTitle: "Crimson Desert PS5 Review",
          category: "performance",
          platform: "ps5",
          confidence: "medium",
          summary: "Review coverage with no reported issue.",
          extractionProvider: "deterministic",
          extractionModel: null,
          llmCallsUsed: 1,
          llmCostUsd: 0,
          fallbackReason: "openrouter_invalid_json",
        };
      }
      return {
        issueTitle: "FPS regression since 1.13",
        category: "performance",
        platform: "pc_steam",
        confidence: "medium",
        summary: "Players report FPS drops on Steam after patch 1.13.",
        extractionProvider: "openrouter",
        extractionModel: "openrouter/free",
        llmCallsUsed: 1,
        llmCostUsd: 0,
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(result.skips.filter((skip) => skip === "source_not_issue_report")).toHaveLength(2);
    expect(result.prefilterRejected).toBe(2);
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      title: "Crimson Desert patch 1.13 FPS drops",
      category: "performance",
      public_status: "private",
    });
    expect(rejectedCandidateRows()).toHaveLength(2);
    const runId = tables.automation_runs[0].id;
    expect(rejectedCandidateRows().every((row) => row.run_id === runId)).toBe(true);
    expect(rejectedCandidateRows().map((row) => row.reason)).toEqual([
      "source_not_issue_report",
      "source_not_issue_report",
    ]);
    expect(rejectedCandidateRows()[0]).toMatchObject({
      title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
      url: "https://example.com/patch-notes",
      source_domain: "example.com",
      source_published_at: "2026-07-05T10:00:00.000Z",
    });
  });

  it("dry runs record zero rejected candidates even when candidates fail pre-screen", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/patch-notes",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "dry_run", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.prefilterRejected).toBeGreaterThan(0);
    expect(rejectedCandidateRows()).toHaveLength(0);
    expect(mutations.filter((mutation) => mutation.table === "automation_rejected_candidates")).toHaveLength(0);
  });

  it("deletes expired rejected-candidate rows on a non-dry run", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      automation_rejected_candidates: [
        {
          id: "rejected-old",
          run_id: "run-old",
          title: "Old rejected candidate",
          url: "https://example.com/old",
          source_domain: "example.com",
          snippet: "stale",
          reason: "source_not_issue_report",
          created_at: "2026-06-01T00:00:00.000Z",
          expires_at: "2026-06-08T00:00:00.000Z",
          rescued_at: null,
        },
      ],
    });
    configureProviders();
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(rejectedCandidateRows().find((row) => row.id === "rejected-old")).toBeUndefined();
    expect(mutations.some((mutation) => mutation.table === "automation_rejected_candidates" && mutation.type === "delete")).toBe(
      true,
    );
  });

  it("makes zero LLM calls and records the run funnel when every candidate fails pre-screen", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/patch-notes",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
      {
        title: "Crimson Desert PS5 Review",
        url: "https://www.youtube.com/watch?v=review",
        snippet: "A general review of the game on PlayStation 5.",
        sourceDomain: "youtube.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.llmCallsUsed).toBe(0);
    expect(result.skips).toContain("all_candidates_prefiltered");
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
    expect(result.candidatesSeen).toBe(2);
    expect(result.prefilterRejected).toBe(2);
    expect(result.signalsInserted).toBe(0);
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      funnel: {
        searchResultsSeen: 2,
        candidatesSeen: 2,
        deduped: 0,
        prefilterRejected: 2,
        llmEligible: 0,
        llmCalls: 0,
        kept: 0,
        promoted: 0,
      },
    });
  });

  it("rescues a borderline current-patch trusted source as a private candidate", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/thin/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.candidatesRescued).toBe(1);
    expect(result.signalsInserted).toBe(1);
    expect(result.prefilterRejected).toBe(0);
    expect(result.skips).toContain("candidate_rescued");
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledTimes(1);
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      source_domain: "reddit.com",
      public_status: "private",
    });
    expect(tables.automation_runs[0]).toMatchObject({
      candidates_rescued: 1,
    });
  });

  it("reads full trusted-source content before rejecting and rescues on the recon text", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    // Thin snippet lacks symptom language (would be source_not_issue_report) but is a
    // borderline trusted current-patch candidate. The real thread text has the symptom.
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00 across the whole map.",
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(1);
    expect(mocks.tavilyExtract.mock.calls[0][0]).toBe(
      "https://reddit.com/r/CrimsonDesert/comments/recon/current_patch",
    );
    expect(result.candidatesRescued).toBe(1);
    expect(result.signalsInserted).toBe(1);
    expect(result.prefilterRejected).toBe(0);
    expect(result.skips).toContain("candidate_recon");
    expect(result.skips).toContain("candidate_rescued");
    // Ledger: each search query and each recon fetch books exactly one Tavily
    // credit, so searchQueriesUsed = search queries issued + recon fetches, and
    // estimatedCostUsd rises by SEARCH_QUERY_COST_USD (0.008) per recon fetch.
    const reconFetches = mocks.tavilyExtract.mock.calls.length;
    expect(reconFetches).toBe(1);
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued + reconFetches);
    expect(result.estimatedCostUsd).toBeCloseTo(result.searchQueriesUsed * 0.008 + result.llmCostUsd, 10);
    // The LLM classified the FULL recon text, not the thin snippet.
    expect(mocks.extractSignalWithOpenRouter.mock.calls[0][0].snippet).toContain("constant stutter and fps drops");
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      source_domain: "reddit.com",
      public_status: "private",
    });
    // Stored raw_text is the real thread, not the thin snippet.
    expect(sourceSignalRows()[0].raw_text).toContain("constant stutter and fps drops on patch 1.13.00");
  });

  it("caps recon fetches per run and falls back to snippet-only for the overflow", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    // Four borderline trusted current-patch candidates, each thin. MAX_RECON_FETCHES_PER_RUN is 3.
    mocks.tavilySearch.mockImplementationOnce(async () =>
      Array.from({ length: 4 }, (_, index) => ({
        title: "Crimson Desert patch 1.13 player discussion",
        url: `https://reddit.com/r/CrimsonDesert/comments/recon-${index}/current_patch/`,
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      })),
    );
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00 across the whole map.",
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // At most three recon fetches; the fourth candidate falls back to snippet-only borderline.
    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(3);
    expect(result.skips.filter((skip) => skip === "candidate_recon")).toHaveLength(3);
    expect(result.status).not.toBe("failed");
    // Ledger: exactly three recon credits booked (the overflow candidate books none).
    const reconFetches = mocks.tavilyExtract.mock.calls.length;
    expect(reconFetches).toBe(3);
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued + reconFetches);
    expect(result.estimatedCostUsd).toBeCloseTo(result.searchQueriesUsed * 0.008 + result.llmCostUsd, 10);
    // The three recon-rescued candidates are kept; the overflow one still runs the
    // old snippet-only borderline extract (which also keeps under the default mock).
    expect(result.candidatesRescued).toBe(4);
    expect(sourceSignalRows()).toHaveLength(4);
  });

  it("does not recon-fetch a non-trusted borderline candidate", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://example.com/discussion/current_patch",
        snippet: "Body retained for moderator review.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00.",
    );
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // example.com is not trusted, so it never enters the borderline lane and recon never fires.
    expect(mocks.tavilyExtract).not.toHaveBeenCalled();
  });

  it("does not recon-fetch when paid search is not allowed", async () => {
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "0";
    // A trusted borderline Reddit candidate still flows through prepareSignals even with
    // paid search off, but the recon fetch must be gated behind allowPaidSearch.
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-borderline",
        title: "Crimson Desert patch 1.13 player discussion",
        selftext: "Body retained for moderator review.",
        permalink: "/r/CrimsonDesert/comments/reddit-borderline/current_patch/",
        created_utc: Math.floor(new Date("2026-07-05T11:00:00.000Z").getTime() / 1000),
      },
    ]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00.",
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).toContain("budget_zero");
    expect(mocks.tavilyExtract).not.toHaveBeenCalled();
    expect(result.skips).not.toContain("candidate_recon");
  });

  it("does not book a phantom recon credit when Tavily is unconfigured but paid search is allowed", async () => {
    // The phantom-charge bug: allowPaidSearch stays true (budget-driven), but with
    // TAVILY_API_KEY unset tavilyExtract makes ZERO network calls and returns null.
    // Recon must be gated on features().webSearch so it never books a credit here.
    const savedKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    // A trusted reddit.com borderline current-patch candidate arrives via Reddit
    // (web search can't run without the key, but Reddit still can).
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-borderline-nokey",
        title: "Crimson Desert patch 1.13 player discussion",
        selftext: "Body retained for moderator review.",
        permalink: "/r/CrimsonDesert/comments/reddit-borderline-nokey/current_patch/",
        created_utc: Math.floor(new Date("2026-07-05T11:00:00.000Z").getTime() / 1000),
      },
    ]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00.",
    );
    try {
      const { runAutomationMonitor } = await importRunner();

      const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

      expect(mocks.tavilyExtract).not.toHaveBeenCalled();
      expect(result.skips).not.toContain("candidate_recon");
      // No phantom Tavily credit booked and no phantom cost.
      expect(result.searchQueriesUsed).toBe(0);
      expect(result.estimatedCostUsd).toBeCloseTo(result.llmCostUsd, 10);
    } finally {
      if (savedKey === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = savedKey;
    }
  });

  it("hides existing public stale source links during a later scan even when no new mentions are kept", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-old-fps",
          slug: "old-fps",
          title: "Old FPS regression",
          category: "performance",
          description: "Old public scanner source.",
          fix_status: "reported",
          confidence: "medium",
          is_public: true,
          auto_public: true,
          public_signal_count: 1,
        },
      ],
      source_signals: [
        {
          id: "signal-old-fps",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://steamcommunity.com/app/old",
          canonical_url: "https://steamcommunity.com/app/old",
          title: "MASSIVE frame drops and stuttering after 1.04",
          summary: "Players discuss frame drops after patch 1.04.",
          source_domain: "steamcommunity.com",
          source_published_at: "2026-05-01T12:00:00.000Z",
          semantic_fingerprint: "old-fps",
          cluster_id: "cluster-old-fps",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-05-01T12:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/patch-notes",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.staleSignalsHidden).toBe(1);
    expect(result.signalsInserted).toBe(0);
    expect(sourceSignalRows()[0]).toMatchObject({
      public_status: "hidden",
      promotion_reason: "wrong_patch",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      public_signal_count: 0,
      auto_public: false,
      is_public: false,
    });
    expect(tables.automation_runs[0]).toMatchObject({
      stale_signals_hidden: 1,
    });
  });

  it("quarantines stale public source links beyond the first audit page", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    const freshSignals = Array.from({ length: 501 }, (_, index) => ({
      id: `signal-current-${index}`,
      source: "web_search",
      source_type: "web_search",
      source_url: `https://example.com/current-${index}`,
      canonical_url: `https://example.com/current-${index}`,
      title: `Crimson Desert patch 1.13 FPS report ${index}`,
      summary: "Players discuss current patch FPS drops.",
      source_domain: "example.com",
      source_published_at: "2026-07-04T12:00:00.000Z",
      observed_at: "2026-07-04T12:00:00.000Z",
      last_seen_at: "2026-07-04T12:00:00.000Z",
      public_status: "public",
    }));
    resetDb({
      issue_clusters: [
        {
          id: "cluster-old-fps",
          slug: "old-fps",
          title: "Old FPS regression",
          category: "performance",
          description: "Old public scanner source.",
          fix_status: "reported",
          confidence: "medium",
          is_public: true,
          auto_public: true,
          public_signal_count: 1,
        },
      ],
      source_signals: [
        ...freshSignals,
        {
          id: "signal-old-fps",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://steamcommunity.com/app/old",
          canonical_url: "https://steamcommunity.com/app/old",
          title: "MASSIVE frame drops and stuttering after 1.04",
          summary: "Players discuss frame drops after patch 1.04.",
          source_domain: "steamcommunity.com",
          source_published_at: "2026-05-01T12:00:00.000Z",
          semantic_fingerprint: "old-fps",
          cluster_id: "cluster-old-fps",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-05-01T12:00:00.000Z",
          last_seen_at: "2026-07-05T12:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.staleSignalsHidden).toBe(1);
    expect(sourceSignalRows().find((row) => row.id === "signal-old-fps")).toMatchObject({
      public_status: "hidden",
      promotion_reason: "wrong_patch",
    });
  });

  it("keeps stale source links hidden when a direct report makes the cluster visible", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Direct report cluster with stale public source.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          public_signal_count: 1,
        },
      ],
      bug_reports: [
        {
          id: "report-map",
          category: "crash_startup",
          platform: "ps5",
          issue_title: "Map crash on PS5",
          moderation_status: "approved",
          cluster_id: "cluster-map",
        },
      ],
      source_signals: [
        {
          id: "signal-old-map",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://reddit.com/r/CrimsonDesert/old-map",
          canonical_url: "https://reddit.com/r/CrimsonDesert/old-map",
          title: "New freezes / crashes on 1.03",
          summary: "Players discuss crashes on patch 1.03.",
          source_domain: "reddit.com",
          source_published_at: "2026-04-01T12:00:00.000Z",
          semantic_fingerprint: "old-map-crash",
          cluster_id: "cluster-map",
          category: "crash_startup",
          confidence: "medium",
          observed_at: "2026-04-01T12:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    delete process.env.TAVILY_API_KEY;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.staleSignalsHidden).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      public_status: "hidden",
      promotion_reason: "wrong_patch",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      direct_report_count: 1,
      public_signal_count: 0,
      auto_public: true,
      is_public: true,
    });
  });

  it("increments seen_count for the same canonical URL instead of duplicating evidence", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockImplementation(async () => [
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://example.com/fps",
        snippet: "Players report FPS drops on Steam after patch 1.13.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T10:00:00.000Z",
      },
    ]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });
    const secondResult = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T13:00:00.000Z") });

    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      seen_count: 2,
      first_seen_at: "2026-07-05T12:00:00.000Z",
      last_seen_at: "2026-07-05T13:00:00.000Z",
      last_seen_run_id: tables.automation_runs[1].id,
    });
    expect(secondResult.signalsReobserved).toBe(1);
    expect(tables.automation_runs[1]).toMatchObject({
      signals_reobserved: 1,
    });
  });

  it("changes the next scheduled intent after a zero-kept scan", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      automation_runs: [
        {
          id: "run-zero-kept",
          started_at: "2026-07-05T10:00:00.000Z",
          status: "success",
          mode: "scheduled",
          search_results_seen: 5,
          signals_inserted: 0,
          funnel: { candidatesSeen: 5, prefilterRejected: 5, kept: 0 },
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 13:00Z -> odd rotation offset lands the two-lane [discovery, corroborate]
    // rotation on corroborate, so the zero-kept memory drives corroboration.
    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T13:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("player reports corroborate");
    expect(tables.automation_runs[1]).toMatchObject({
      intent: "corroborate_cluster",
    });
  });

  it("targets corroboration when private weak source signals exist", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "shader-stutter",
          title: "Shader compilation stutter",
          category: "performance",
          description: "Seeded weak cluster.",
          fix_status: "reported",
          confidence: "low",
          is_public: true,
          auto_public: false,
        },
      ],
      source_signals: [
        {
          id: "signal-private-fps",
          cluster_id: "cluster-fps",
          public_status: "private",
          title: "Crimson Desert patch 1.13 FPS drops",
          summary: "Private current-patch candidate.",
          observed_at: "2026-07-05T10:00:00.000Z",
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 13:00Z -> odd rotation offset lands the two-lane [discovery, corroborate]
    // rotation on corroborate (discovery still gets its turn on other offsets).
    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T13:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("player reports corroborate");
    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("Shader compilation stutter");
    expect(tables.automation_runs[0]).toMatchObject({ intent: "corroborate_cluster" });
  });

  it("hunts zero-evidence public seed clusters by name", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-boss-crash",
          slug: "boss-rematch-crash-persistent",
          title: "Boss rematch crash persistent",
          category: "crash_startup",
          description: "Public seed cluster with no evidence yet.",
          fix_status: "reported",
          confidence: "seed_unverified",
          is_public: true,
          auto_public: false,
          signal_count: 0,
          direct_report_count: 0,
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 13:00Z -> rotation offset is odd, so the two-lane [discovery, corroborate]
    // rotation lands on corroborate and the seed cluster title is hunted by name.
    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T13:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(result.targetClusterTitles).toContain("Boss rematch crash persistent");
    expect(result.intent).toBe("corroborate_cluster");
    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("Boss rematch crash persistent");
    expect(tables.automation_runs[0]).toMatchObject({ intent: "corroborate_cluster" });
  });

  it("targets rescue when live rejected candidates exist", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      automation_rejected_candidates: [
        {
          id: "rejected-promising",
          title: "Promising thin current patch source",
          url: "https://steamcommunity.com/app/promising",
          source_domain: "steamcommunity.com",
          snippet: "thin",
          reason: "source_not_issue_report",
          expires_at: "2026-07-12T12:00:00.000Z",
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 13:00Z -> odd rotation offset lands the two-lane [discovery, rescue]
    // rotation on rescue (discovery still gets its turn on other offsets).
    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T13:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("site:reddit.com OR site:steamcommunity.com");
    expect(tables.automation_runs[0]).toMatchObject({ intent: "rescue_candidate" });
  });

  it("ignores stale, rescued, and non-rescuable rejected candidates when planning rescue", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      automation_rejected_candidates: [
        {
          id: "rejected-wrong-patch",
          title: "Patch 1.04 crash report",
          url: "https://steamcommunity.com/app/wrong-patch",
          source_domain: "steamcommunity.com",
          snippet: "Crash after 1.04.",
          reason: "wrong_patch",
          expires_at: "2026-07-12T12:00:00.000Z",
          rescued_at: null,
        },
        {
          id: "rejected-stale-source",
          title: "Old performance report",
          url: "https://steamcommunity.com/app/stale",
          source_domain: "steamcommunity.com",
          snippet: "FPS drops.",
          reason: "stale_source",
          expires_at: "2026-07-12T12:00:00.000Z",
          rescued_at: null,
        },
        {
          id: "rejected-already-rescued",
          title: "Promising current patch source",
          url: "https://steamcommunity.com/app/rescued",
          source_domain: "steamcommunity.com",
          snippet: "thin",
          reason: "source_not_issue_report",
          expires_at: "2026-07-12T12:00:00.000Z",
          rescued_at: "2026-07-05T10:00:00.000Z",
        },
        {
          id: "rejected-expired",
          title: "Expired current patch source",
          url: "https://steamcommunity.com/app/expired",
          source_domain: "steamcommunity.com",
          snippet: "thin",
          reason: "source_not_issue_report",
          expires_at: "2026-07-01T12:00:00.000Z",
          rescued_at: null,
        },
      ],
    });
    configureProviders();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_qwen_pro",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).not.toContain("site:reddit.com OR site:steamcommunity.com");
    expect(tables.automation_runs[0]).not.toMatchObject({ intent: "rescue_candidate" });
  });

  it("preserves candidate freshness when rescuing a rejected source", async () => {
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from } as never,
      {
        title: "Thin player report",
        url: "https://reddit.com/r/CrimsonDesert/comments/thin/report/",
        sourceDomain: "reddit.com",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
        snippet: "Players report FPS drops after the current patch.",
      },
    );

    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      canonical_url: "https://reddit.com/r/CrimsonDesert/comments/thin/report",
      source_published_at: "2026-07-05T11:00:00.000Z",
    });
  });

  it("routes a kept signal into a seeded watchlist cluster instead of creating a new one", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-seeded-perf",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Seeded watchlist cluster.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
        },
      ],
    });
    configureProviders();
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-fps-route",
        title: "FPS drops since 1.13",
        selftext: "Steam users are seeing stutter.",
        permalink: "/r/CrimsonDesert/comments/reddit-fps-route/fps/",
        created_utc: 1783260000,
      },
    ]);
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(tables.issue_clusters).toHaveLength(1);
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-seeded-perf",
    });
  });

  it("keeps a public seeded watchlist cluster visible when a below-threshold signal routes into it", async () => {
    delete process.env.TAVILY_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-seeded-perf",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Seeded watchlist cluster.",
          fix_status: "reported",
          confidence: "seed_unverified",
          is_public: true,
          auto_public: false,
        },
      ],
    });
    configureProviders();
    mocks.fetchNewPosts.mockResolvedValue([
      {
        id: "reddit-fps-seed-visible",
        title: "FPS drops since 1.13",
        selftext: "Steam users are seeing stutter.",
        permalink: "/r/CrimsonDesert/comments/reddit-fps-seed-visible/fps/",
        created_utc: 1783260000,
      },
    ]);
    delete process.env.TAVILY_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    // The lone routed signal is below the promotion threshold and stays private...
    expect(sourceSignalRows()[0]).toMatchObject({ cluster_id: "cluster-seeded-perf", public_status: "private" });
    // ...but the seeded watchlist item must remain publicly visible, not vanish.
    expect(tables.issue_clusters[0]).toMatchObject({
      public_signal_count: 0,
      auto_public: false,
      is_public: true,
    });
  });

  it("keeps an auto-public cluster visible when its public signal goes stale but a live current-patch candidate remains", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-crash-hang",
          slug: "crash_startup_hang",
          title: "Crash / hang on startup",
          category: "crash_startup",
          description: "Auto-promoted crash cluster whose public evidence went stale.",
          fix_status: "reported",
          confidence: "medium",
          is_public: true,
          auto_public: true,
          public_signal_count: 1,
        },
      ],
      source_signals: [
        {
          id: "signal-crash-stale",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://steamcommunity.com/app/crash-old",
          canonical_url: "https://steamcommunity.com/app/crash-old",
          title: "Game crashes on startup after 1.04",
          summary: "Players report startup crashes on patch 1.04.",
          source_domain: "steamcommunity.com",
          source_published_at: "2026-05-01T12:00:00.000Z",
          semantic_fingerprint: "crash-hang-stale",
          cluster_id: "cluster-crash-hang",
          category: "crash_startup",
          confidence: "medium",
          observed_at: "2026-05-01T12:00:00.000Z",
          public_status: "public",
        },
        {
          id: "signal-crash-live",
          source: "reddit",
          source_type: "reddit",
          source_url: "https://reddit.com/r/CrimsonDesert/crash-live",
          canonical_url: "https://reddit.com/r/CrimsonDesert/crash-live",
          title: "PS5 crash on startup since latest patch",
          summary: "PS5 and Steam players hit a startup crash on the current build.",
          source_domain: "reddit.com",
          source_published_at: "2026-07-04T12:00:00.000Z",
          semantic_fingerprint: "crash-hang-live",
          cluster_id: "cluster-crash-hang",
          category: "crash_startup",
          confidence: "medium",
          observed_at: "2026-07-04T12:00:00.000Z",
          public_status: "private",
        },
      ],
    });
    configureProviders();
    delete process.env.TAVILY_API_KEY;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // The stale public source is quarantined, dropping the cluster below threshold.
    expect(result.staleSignalsHidden).toBe(1);
    const staleRow = sourceSignalRows().find((row) => row.id === "signal-crash-stale");
    expect(staleRow).toMatchObject({ public_status: "hidden", promotion_reason: "wrong_patch" });
    // Promotion stays strict: the live current-patch candidate is NOT published.
    const liveRow = sourceSignalRows().find((row) => row.id === "signal-crash-live");
    expect(liveRow).toMatchObject({ public_status: "private" });
    // But the cluster stays VISIBLE as a watchlist row because it still holds a live
    // current-patch candidate — it must not be hidden.
    expect(tables.issue_clusters[0]).toMatchObject({
      public_signal_count: 0,
      auto_public: false,
      is_public: true,
    });
  });

  it("does not promote from a stale existing signal plus one fresh source", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "fps-regression",
          title: "FPS regression since 1.13",
          category: "performance",
          description: "Existing stale source signal.",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
        },
      ],
      source_signals: [
        {
          id: "signal-stale",
          source: "web_search",
          source_type: "web_search",
          source_domain: "example.com",
          canonical_url: "https://example.com/stale-fps",
          semantic_fingerprint: "8d641d5b7955407f77fbce6d53665716d5b292f614e545a4220ad6c54d0c99f9",
          cluster_id: "cluster-fps",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-06-19T12:00:00.000Z",
          extracted_facts: { platform: "pc_steam" },
          public_status: "private",
        },
      ],
    });
    configureProviders();
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(result.clustersPromoted).toBe(0);
    expect(sourceSignalRows()).toHaveLength(2);
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["private", "private"]);
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 0,
      auto_public: false,
      is_public: false,
    });
  });

  it("records promotion update failures without incrementing promoted clusters", async () => {
    updateFailure = { table: "source_signals", message: "source signal status update failed" };
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("source signal status update failed");
    expect(result.clustersPromoted).toBe(0);
    expect(tables.automation_runs[0]).toMatchObject({
      status: "failed",
      clusters_promoted: 0,
      errors: [expect.stringContaining("source signal status update failed")],
    });
  });

  it("creates a running ledger row first, then finalizes the same row with a terminal status", async () => {
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.automation_runs).toHaveLength(1);
    const insertMutation = mutations.find((mutation) => mutation.table === "automation_runs" && mutation.type === "insert");
    expect(insertMutation).toBeDefined();
    expect(insertMutation!.row).toMatchObject({ status: "running" });
    expect((insertMutation!.row as { finished_at?: unknown }).finished_at).toBeUndefined();

    const finalRow = tables.automation_runs[0];
    expect(finalRow.id).toBe((insertMutation!.row as { id: string }).id);
    expect(finalRow.status).toBe(result.status);
    expect(finalRow.finished_at).toBeTruthy();

    const updateMutations = mutations.filter(
      (mutation) => mutation.table === "automation_runs" && mutation.type === "update",
    );
    const finalizeMutation = updateMutations.find(
      (mutation) => (mutation.row as { finished_at?: unknown }).finished_at,
    );
    expect(finalizeMutation).toBeDefined();
  });

  it("sweeps stale running runs to failed with a 15-minute started_at cutoff", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-stale",
          status: "running",
          started_at: "2026-07-05T11:00:00.000Z",
        },
      ],
    });
    configureProviders();
    const { sweepStaleRuns } = await importRunner();

    const now = new Date("2026-07-05T12:00:00.000Z");
    await sweepStaleRuns({ from: mocks.from } as unknown as Parameters<typeof sweepStaleRuns>[0], now);

    const sweepUpdate = mutations.find(
      (mutation) => mutation.table === "automation_runs" && mutation.type === "update" && (mutation.row as { status?: unknown }).status === "failed",
    );
    expect(sweepUpdate).toBeDefined();
    expect(tables.automation_runs[0]).toMatchObject({ status: "failed", finished_at: now.toISOString() });
  });

  it("startAutomationScan reports already_running when a running row exists within the stale window", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-active",
          status: "running",
          started_at: "2026-07-05T11:55:00.000Z",
        },
      ],
    });
    configureProviders();
    const { startAutomationScan } = await importRunner();

    const started = await startAutomationScan({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(started).toEqual({ status: "already_running", runId: null });
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
  });

  it("writes a screening-stage progress update while candidates are being processed", async () => {
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    const progressUpdates = mutations
      .filter((mutation) => mutation.table === "automation_runs" && mutation.type === "update")
      .map((mutation) => (mutation.row as { progress?: { stage?: string } }).progress)
      .filter((progress): progress is { stage?: string } => Boolean(progress));

    expect(progressUpdates.some((progress) => progress.stage === "screening")).toBe(true);
  });
});

describe("cron keepalive route", () => {
  it("blocks authenticated cron writes in Vercel preview", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.VERCEL_ENV = "preview";
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "preview_writes_disabled" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getAutomationControlState).not.toHaveBeenCalled();
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
  });

  it("returns unauthorized when CRON_SECRET is set and the bearer token is missing", async () => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(new Request("https://example.com/api/cron/keepalive"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(new Request("https://example.com/api/cron/keepalive"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "cron secret missing" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
  });

  it("skips scheduled automation when the scanner is paused", async () => {
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
      automation_runs: [],
    });
    configureProviders();
    mocks.getAutomationControlState.mockResolvedValue({ paused: true, updatedAt: "2026-07-05T12:00:00.000Z" });
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      automation: { status: "skipped", reason: "paused" },
    });
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
    expect(mocks.insertSkippedScheduledRun).toHaveBeenCalledWith(expect.anything(), "paused", expect.any(Date));
  });

  it("preserves keepalive and purge work but skips automation when a recent run exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [
        {
          id: "run-recent",
          started_at: "2026-07-05T11:30:00.000Z",
          estimated_cost_usd: 0,
          mode: "scheduled",
          status: "success",
        },
      ],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
      source_signals: [
        {
          id: "signal-old",
          raw_text: "expired raw text",
          raw_expires_at: "2026-07-05T01:00:00.000Z",
        },
      ],
    });
    configureProviders();
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      touch: "ok",
      purge: "ok",
      automation: { status: "skipped", reason: "recent_run" },
    });
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
    expect(mocks.insertSkippedScheduledRun).toHaveBeenCalledWith(expect.anything(), "recent_run", expect.any(Date));
    expect(tables.source_signals[0]).toMatchObject({ raw_text: null, raw_expires_at: null });
  });

  it("uses the scanner policy interval when deciding whether a run is recent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [
        {
          id: "run-recent-policy",
          started_at: "2026-07-05T10:30:00.000Z",
          estimated_cost_usd: 0,
          mode: "manual",
          status: "success",
        },
      ],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
    });
    configureProviders();
    mocks.getAutomationControlState.mockResolvedValue({
      paused: false,
      minIntervalMinutes: 120,
      scheduledSearchCreditsPerRun: 1,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 1,
      modelPreset: "deepseek_qwen_pro",
      updatedAt: "2026-07-05T12:00:00.000Z",
    });
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      automation: { status: "skipped", reason: "recent_run" },
    });
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
    expect(mocks.insertSkippedScheduledRun).toHaveBeenCalledWith(expect.anything(), "recent_run", expect.any(Date));
  });

  it("skips with a running reason when a scheduled attempt finds an active scan", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [
        {
          id: "run-active",
          started_at: "2026-07-05T11:55:00.000Z",
          estimated_cost_usd: 0,
          mode: "manual",
          status: "running",
        },
      ],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
    });
    configureProviders();
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      automation: { status: "skipped", reason: "scan_already_running" },
    });
    expect(mocks.runAutomationMonitor).not.toHaveBeenCalled();
    expect(mocks.insertSkippedScheduledRun).toHaveBeenCalledWith(
      expect.anything(),
      "scan_already_running",
      expect.any(Date),
    );
  });

  it("runs the scheduled scan when only a dry run is recent and writes no skip marker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [
        {
          id: "run-dry",
          started_at: "2026-07-05T08:00:00.000Z",
          estimated_cost_usd: 0,
          mode: "dry_run",
          status: "success",
        },
      ],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
    });
    configureProviders();
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      automation: { status: "success" },
    });
    expect(mocks.runAutomationMonitor).toHaveBeenCalledWith({
      mode: "scheduled",
      scannerPolicy: expect.objectContaining({
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
      }),
    });
    expect(mocks.insertSkippedScheduledRun).not.toHaveBeenCalled();
  });
});

describe("cron source preview route", () => {
  it("requires the cron bearer token before running a source preview", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const previewAutomationSearch = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/automation/preview", () => ({ previewAutomationSearch }));
    const { GET } = await import("@/app/api/cron/source-preview/route");

    const response = await GET(new Request("https://example.com/api/cron/source-preview?queries=1"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(previewAutomationSearch).not.toHaveBeenCalled();
  });

  it("runs a bounded source preview behind cron auth", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const previewAutomationSearch = vi.fn().mockResolvedValue({
      mode: "preview",
      maxQueries: 2,
      queriesUsed: 1,
      resultsSeen: 1,
      estimatedCostUsd: 0.008,
      previews: [
        {
          query: "Crimson Desert patch 1.13.00 FPS",
          title: "Crimson Desert FPS drops",
          url: "https://example.com/fps",
          sourceDomain: "example.com",
          extraction: {
            issueTitle: "FPS regression since 1.13",
            category: "performance",
            platform: "pc_steam",
            confidence: "medium",
            summary: "Players report FPS drops after patch 1.13.",
            extractionProvider: "openrouter",
            extractionModel: "openrouter/free",
            llmCallsUsed: 1,
            llmCostUsd: 0,
          },
        },
      ],
    });
    vi.resetModules();
    vi.doMock("@/lib/automation/preview", () => ({ previewAutomationSearch }));
    const { GET } = await import("@/app/api/cron/source-preview/route");

    const response = await GET(
      new Request("https://example.com/api/cron/source-preview?queries=3", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      preview: {
        mode: "preview",
        maxQueries: 2,
        queriesUsed: 1,
        estimatedCostUsd: 0.008,
      },
    });
    expect(previewAutomationSearch).toHaveBeenCalledWith({ maxQueries: 2 });
  });
});
