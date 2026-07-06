import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractSignalWithOpenRouter: vi.fn(),
  fetchNewPosts: vi.fn(),
  from: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
  getRedditToken: vi.fn(),
  getAutomationControlState: vi.fn(),
  runAutomationMonitor: vi.fn(),
  syncOfficialPatchNote: vi.fn(),
  tavilySearch: vi.fn(),
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
  | "official_patch_notes"
  | "source_signals"
  | "issue_clusters"
  | "bug_reports"
  | "approved_excerpts"
  | "automation_settings";
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "not"; column: string; operator: string; value: unknown };

const tables: Record<TableName, Row[]> = {
  automation_runs: [],
  official_patch_notes: [],
  source_signals: [],
  issue_clusters: [],
  bug_reports: [],
  approved_excerpts: [],
  automation_settings: [],
};
const mutations: { table: TableName; type: "insert" | "update" | "upsert"; row: unknown }[] = [];
let idSeq = 1;
let openRouterAttempts = 0;
let selectFailure: { table: TableName; message: string } | null = null;
let updateFailure: { table: TableName; message: string } | null = null;

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
  if (filter.type === "in") return filter.value.includes(value);
  if (filter.type === "gte") return String(value) >= String(filter.value);
  if (filter.type === "lt") return String(value) < String(filter.value);
  if (filter.type === "not" && filter.operator === "is" && filter.value === null) return value !== null;
  if (filter.type === "not" && filter.operator === "like") return !likeToRegExp(String(filter.value)).test(String(value ?? ""));
  throw new Error(`unsupported filter ${filter.type}`);
}

class FakeQuery {
  private filters: Filter[] = [];
  private insertRows: Row[] | null = null;
  private limitCount: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private patch: Row | null = null;
  private selectOptions: { count?: "exact"; head?: boolean } | undefined;
  private singleResult = false;
  private upsertRows: Row[] | null = null;
  private upsertConflict = "id";

  constructor(private readonly table: TableName) {}

  select(_columns?: string, options?: { count?: "exact"; head?: boolean }) {
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

  upsert(row: Row | Row[], options?: { onConflict?: string }) {
    this.upsertRows = Array.isArray(row) ? row : [row];
    this.upsertConflict = options?.onConflict ?? "id";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
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
    if (this.patch) return this.executeUpdate();
    return this.executeSelect();
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
      mutations.push({ table: this.table, type: "insert", row: next });
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
    if (selectFailure?.table === this.table) {
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
      llmCallUsed: Boolean(canUseOpenRouter),
    };
  });
  mocks.getAutomationControlState.mockResolvedValue({ paused: false, updatedAt: null });
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

  it("fails closed when the monthly automation spend ledger cannot be read", async () => {
    selectFailure = { table: "automation_runs", message: "ledger unavailable" };
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("skipped");
    expect(result.skips).toContain("budget_read_failed");
    expect(result.errors[0]).toContain("ledger unavailable");
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      status: "skipped",
      search_queries_used: 0,
      llm_calls_used: 0,
      signals_inserted: 0,
      errors: [expect.stringContaining("ledger unavailable")],
    });
    expect(mutations.filter((mutation) => mutation.table !== "automation_runs")).toHaveLength(0);
  });

  it("non-dry runs cluster two independent sources and promote them public", async () => {
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

  it("promotes two fresh distinct canonical URLs on the same domain", async () => {
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
    expect(result.clustersPromoted).toBe(1);
    expect(sourceSignalRows()).toHaveLength(2);
    expect(new Set(sourceSignalRows().map((row) => row.canonical_url))).toEqual(
      new Set(["https://same.example/fps-one", "https://same.example/fps-two"]),
    );
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["public", "public"]);
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 2,
      auto_public: true,
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
          llmCallUsed: true,
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
          llmCallUsed: true,
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
        llmCallUsed: true,
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
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
    expect(result.candidatesSeen).toBe(2);
    expect(result.prefilterRejected).toBe(2);
    expect(result.signalsInserted).toBe(0);
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      funnel: {
        candidatesSeen: 2,
        deduped: 0,
        prefilterRejected: 2,
        llmCalls: 0,
        kept: 0,
        promoted: 0,
      },
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
});

describe("cron keepalive route", () => {
  it("blocks authenticated cron writes in Vercel preview", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.VERCEL_ENV = "preview";
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.runAutomationMonitor }));
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
    vi.doMock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.runAutomationMonitor }));
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
    vi.doMock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.runAutomationMonitor }));
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
    vi.doMock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.runAutomationMonitor }));
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
  });

  it("preserves keepalive and purge work but skips automation when a recent run exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [{ id: "run-recent", started_at: "2026-07-05T08:00:00.000Z", estimated_cost_usd: 0 }],
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
    vi.doMock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.runAutomationMonitor }));
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
    expect(tables.source_signals[0]).toMatchObject({ raw_text: null, raw_expires_at: null });
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
            llmCallUsed: true,
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
