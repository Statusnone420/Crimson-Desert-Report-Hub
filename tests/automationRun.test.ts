import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { externalIdHash } from "@/lib/crypto";
import { matchesOrExpression } from "./fixtures/postgrestOr";

const mocks = vi.hoisted(() => ({
  extractSignalWithOpenRouter: vi.fn(),
  from: vi.fn(),
  getClaimedFixesForCurrentPatch: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
  mapClaimToClusterWithOpenRouter: vi.fn(),
  rpc: vi.fn(),
  getAutomationControlState: vi.fn(),
  runAutomationMonitor: vi.fn(),
  insertSkippedScheduledRun: vi.fn(),
  syncOfficialPatchNote: vi.fn(),
  tavilySearch: vi.fn(),
  tavilyExtract: vi.fn(),
  fetchSteamReviewBatch: vi.fn(),
  fetchSteamCurrentPlayers: vi.fn(),
  fetchCrimsonDesertPlatformContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
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

vi.mock("@/lib/automation/claimMapping", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/claimMapping")>();
  return {
    ...actual,
    mapClaimToClusterWithOpenRouter: mocks.mapClaimToClusterWithOpenRouter,
  };
});

vi.mock("@/lib/automation/steam", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/steam")>();
  return {
    ...actual,
    fetchSteamReviewBatch: mocks.fetchSteamReviewBatch,
    fetchSteamCurrentPlayers: mocks.fetchSteamCurrentPlayers,
  };
});

vi.mock("@/lib/platform/igdb", () => ({
  fetchCrimsonDesertPlatformContext: mocks.fetchCrimsonDesertPlatformContext,
}));

vi.mock("@/lib/officialPatch.server", () => ({
  CURRENT_PATCH_TAG: "current-patch",
  PUBLIC_DASHBOARD_TAG: "public-dashboard",
  PUBLIC_ISSUES_TAG: "public-issues",
  getClaimedFixesForCurrentPatch: mocks.getClaimedFixesForCurrentPatch,
  getCurrentPatchMetadata: mocks.getCurrentPatchMetadata,
  syncOfficialPatchNote: mocks.syncOfficialPatchNote,
}));

type Row = Record<string, unknown>;
type TableName =
  | "automation_runs"
  | "automation_rejected_candidates"
  | "scanner_feedback_rules"
  | "official_patch_notes"
  | "source_signals"
  | "steam_review_receipts"
  | "steam_pulse_snapshots"
  | "steam_player_snapshots"
  | "platform_context_snapshots"
  | "patch_observations"
  | "signal_observation_events"
  | "issue_clusters"
  | "bug_reports"
  | "approved_excerpts"
  | "automation_settings";
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "neq"; column: string; value: unknown }
  | { type: "is"; column: string; value: unknown }
  | { type: "gte"; column: string; value: unknown }
  | { type: "gt"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "not"; column: string; operator: string; value: unknown }
  | { type: "or"; expression: string };

const tables: Record<TableName, Row[]> = {
  automation_runs: [],
  automation_rejected_candidates: [],
  scanner_feedback_rules: [],
  official_patch_notes: [],
  source_signals: [],
  steam_review_receipts: [],
  steam_pulse_snapshots: [],
  steam_player_snapshots: [],
  platform_context_snapshots: [],
  patch_observations: [],
  signal_observation_events: [],
  issue_clusters: [],
  bug_reports: [],
  approved_excerpts: [],
  automation_settings: [],
};
const mutations: { table: TableName; type: "insert" | "update" | "upsert" | "delete"; row: unknown; filters?: Filter[] }[] = [];
let idSeq = 1;
let openRouterAttempts = 0;
let selectFailure: { table: TableName; message: string; code?: string; columns?: string } | null = null;
let insertFailure: { table: TableName; message: string; code?: string; column?: string } | null = null;
let updateFailure: { table: TableName; message: string; code?: string; column?: string } | null = null;
let deleteFailure: { table: TableName; message: string } | null = null;
let beforeUpdate: ((table: TableName, patch: Row, filters: Filter[]) => void) | null = null;
let beforeSelect: ((table: TableName) => void) | null = null;
let beforeVisibilityRefreshRpc: ((args: Record<string, unknown>) => void) | null = null;
let visibilityRefreshFailure: string | null = null;
let issueClusterInsertRace: { slug: string; row: Row } | null = null;
let sourceSignalInsertFailure: { title?: string; externalHash?: string; message: string } | null = null;
let observationEventInsertFailure: string | null = null;
let honorSourceSignalProjection = false;
let honorIssueClusterProjection = false;
/**
 * Stands in for the hosted PostgREST row cap: the API can return fewer rows
 * than the requested limit, so a reader that stops on a short page silently
 * drops everything past the cap.
 */
let hostedRowCap: { table: TableName; rows: number } | null = null;

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
  insertFailure = null;
  updateFailure = null;
  deleteFailure = null;
  beforeUpdate = null;
  beforeSelect = null;
  beforeVisibilityRefreshRpc = null;
  visibilityRefreshFailure = null;
  issueClusterInsertRace = null;
  sourceSignalInsertFailure = null;
  observationEventInsertFailure = null;
  honorSourceSignalProjection = false;
  honorIssueClusterProjection = false;
  hostedRowCap = null;
}

function nextId(table: TableName) {
  return `${table}-${idSeq++}`;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function passesFilter(row: Row, filter: Filter): boolean {
  if (filter.type === "or") return matchesOrExpression(row, filter.expression);
  const value = row[filter.column];
  if (filter.type === "eq") return value === filter.value;
  if (filter.type === "neq") return value !== filter.value;
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
  // A list, not a single key: the feedback-rule walk orders by created_at then
  // id, and collapsing that to the last .order() call would let a tied
  // timestamp produce a cursor that reads the same rows twice.
  private orderBy: { column: string; ascending: boolean }[] = [];
  private patch: Row | null = null;
  private rangeBounds: { from: number; to: number } | null = null;
  private selectedColumns: string | undefined;
  private selectOptions: { count?: "exact"; head?: boolean } | undefined;
  private singleResult = false;
  private upsertRows: Row[] | null = null;
  private upsertConflict = "id";
  private ignoreDuplicates = false;

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

  upsert(row: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.upsertRows = Array.isArray(row) ? row : [row];
    this.upsertConflict = options?.onConflict ?? "id";
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: "neq", column, value });
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

  or(expression: string) {
    this.filters.push({ type: "or", expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push({ column, ascending: options?.ascending ?? true });
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
    if (this.table === "issue_clusters" && issueClusterInsertRace) {
      const row = this.insertRows![0];
      if (row?.slug === issueClusterInsertRace.slug) {
        const race = issueClusterInsertRace;
        issueClusterInsertRace = null;
        tables.issue_clusters.push({
          id: race.row.id ?? nextId(this.table),
          created_at: race.row.created_at ?? "2026-07-05T12:00:00.000Z",
          ...race.row,
        });
        return {
          data: null,
          error: {
            code: "23505",
            constraint: "issue_clusters_slug_key",
            message: `duplicate key value violates unique constraint "issue_clusters_slug_key"`,
          },
        };
      }
    }
    if (
      this.table === "source_signals" &&
      sourceSignalInsertFailure &&
      this.insertRows!.some(
        (row) =>
          (sourceSignalInsertFailure!.title !== undefined && row.title === sourceSignalInsertFailure!.title) ||
          (sourceSignalInsertFailure!.externalHash !== undefined &&
            row.external_id_hash === sourceSignalInsertFailure!.externalHash),
      )
    ) {
      return { data: null, error: { message: sourceSignalInsertFailure.message } };
    }
    if (this.table === "signal_observation_events" && observationEventInsertFailure) {
      return { data: null, error: { message: observationEventInsertFailure } };
    }
    if (
      insertFailure?.table === this.table &&
      (!insertFailure.column || this.insertRows!.some((row) => insertFailure!.column! in row))
    ) {
      return { data: null, error: { code: insertFailure.code, message: insertFailure.message } };
    }
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
    if (insertFailure?.table === this.table && (!insertFailure.column || this.upsertRows!.some(row => insertFailure!.column! in row))) {
      return { data: null, error: { code: insertFailure.code, message: insertFailure.message } };
    }
    const rows = this.upsertRows!.map((row) => {
      const existing = tables[this.table].find((item) => item[this.upsertConflict] === row[this.upsertConflict]);
      if (existing) {
        if (this.ignoreDuplicates) return existing;
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
    if (
      updateFailure?.table === this.table &&
      (!updateFailure.column || updateFailure.column in this.patch!)
    ) {
      return { data: null, error: { code: updateFailure.code, message: updateFailure.message } };
    }
    beforeUpdate?.(this.table, this.patch!, [...this.filters]);
    const rows = this.filteredRows();
    for (const row of rows) Object.assign(row, this.patch);
    mutations.push({ table: this.table, type: "update", row: this.patch, filters: [...this.filters] });
    return { data: rows, error: null };
  }

  private executeSelect() {
    beforeSelect?.(this.table);
    // A failure with `columns` set targets only queries whose select string
    // contains it (e.g. loadMonthSpend's "estimated_cost_usd"). Substring match,
    // not equality, so adding a column to the production select can't silently
    // turn the injection into a no-op. Without `columns`, every select on the
    // table fails.
    if (
      selectFailure?.table === this.table &&
      (!selectFailure.columns || (this.selectedColumns ?? "").includes(selectFailure.columns))
    ) {
      return {
        data: null,
        count: null,
        error: {
          ...(selectFailure.code ? { code: selectFailure.code } : {}),
          message: selectFailure.message,
        },
      };
    }
    let rows = this.filteredRows().map((row) => ({ ...row }));
    if (
      this.selectedColumns &&
      ((this.table === "source_signals" && honorSourceSignalProjection) ||
        (this.table === "issue_clusters" && honorIssueClusterProjection))
    ) {
      const selected = this.selectedColumns.split(",").map((column) => column.trim());
      rows = rows.map((row) => Object.fromEntries(selected.map((column) => [column, row[column]])));
    }
    if (this.orderBy.length > 0) {
      rows = rows.sort((a, b) => {
        for (const { column, ascending } of this.orderBy) {
          const left = String(a[column] ?? "");
          const right = String(b[column] ?? "");
          const comparison = ascending ? left.localeCompare(right) : right.localeCompare(left);
          if (comparison !== 0) return comparison;
        }
        return 0;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    if (this.rangeBounds !== null) rows = rows.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    if (hostedRowCap?.table === this.table) rows = rows.slice(0, hostedRowCap.rows);
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
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "apply_cluster_visibility_refresh") throw new Error(`unexpected rpc ${name}`);
    if (visibilityRefreshFailure) return { data: null, error: { message: visibilityRefreshFailure } };
    beforeVisibilityRefreshRpc?.(args);

    const cluster = tables.issue_clusters.find((row) => row.id === args.p_cluster_id);
    if (!cluster) return { data: null, error: { message: "issue cluster not found" } };
    if (Number(cluster.visibility_revision ?? 0) !== Number(args.p_expected_revision)) {
      return { data: false, error: null };
    }

    const signalPatches = (args.p_signal_patches ?? []) as Row[];
    for (const signalPatch of signalPatches) {
      const signal = tables.source_signals.find(
        (row) => row.id === signalPatch.id && row.cluster_id === args.p_cluster_id,
      );
      if (!signal) return { data: null, error: { message: "source signal not found in cluster" } };
      Object.assign(signal, signalPatch);
    }

    const clusterPatch = args.p_cluster_patch as Row;
    if (cluster.admin_visibility_override) {
      // A forced state controls only the effective flag. The atomic refresh still
      // advances the engine-owned baseline that Auto will restore later.
      cluster.visibility_restore_auto_public = clusterPatch.auto_public;
      cluster.visibility_restore_is_public = clusterPatch.is_public;
    }
    const effectiveIsPublic =
      cluster.admin_visibility_override === "force_hidden"
        ? false
        : cluster.admin_visibility_override === "force_public"
          ? true
          : clusterPatch.is_public;
    Object.assign(cluster, clusterPatch, {
      is_public: effectiveIsPublic,
      visibility_revision: Number(cluster.visibility_revision ?? 0) + 1,
    });
    return { data: true, error: null };
  });
  mocks.getCurrentPatchMetadata.mockResolvedValue(officialPatchFixture);
  mocks.syncOfficialPatchNote.mockResolvedValue({ status: "synced", changed: false, patch: officialPatchFixture });
  mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([]);
  mocks.mapClaimToClusterWithOpenRouter.mockResolvedValue({
    matchKind: "none",
    clusterId: null,
    clusterSlug: null,
    reason: "No match.",
    llmCallsUsed: 0,
    llmCostUsd: 0,
    extractionModel: null,
  });
  mocks.tavilySearch.mockImplementation(async () => {
    const firstResult = mocks.tavilySearch.mock.calls.length === 1;
    return [
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: firstResult ? "https://reddit.com/r/CrimsonDesert/comments/fps/report" : "https://example.com/fps",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: firstResult ? "reddit.com" : "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ];
  });
  // Recon is off by default: no full-page text unless a test opts in. Existing
  // borderline behavior (extract on the thin snippet) must be unchanged.
  mocks.tavilyExtract.mockResolvedValue(null);
  mocks.fetchSteamReviewBatch.mockResolvedValue({ reviews: [], totals: { totalReviews: 0, totalPositive: 0, totalNegative: 0 }, cursor: null });
  mocks.fetchCrimsonDesertPlatformContext.mockResolvedValue({
    capturedAt: "2026-07-05T12:00:00.000Z",
    igdb: { status: "absent", data: null, error: null },
    twitch: { status: "absent", data: null, error: null },
  });
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
      clusterAssignment: "unsure",
      clusterReason: "The default test extractor does not make a semantic assignment.",
      clusterSlug: null,
      extractionProvider: canUseOpenRouter ? "openrouter" : "deterministic",
      extractionModel: canUseOpenRouter ? "deepseek/deepseek-v4-flash" : null,
      llmCallsUsed: canUseOpenRouter ? 1 : 0,
      llmCostUsd: 0,
    };
  });
  mocks.getAutomationControlState.mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 900,
    monthlyLlmUsdCap: 2,
    modelPreset: "gpt_5_6_luna",
    updatedAt: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
  configureProviders();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "https://openrouter.ai/api/v1/key") throw new Error(`unexpected fetch: ${String(input)}`);
    return Response.json({
      data: { limit: 1, limit_remaining: 1, limit_reset: "monthly", usage_monthly: 0 },
    });
  }));
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.TAVILY_API_KEY = "tavily-key";
  process.env.AUTOMATION_BUDGET_USD_MONTHLY = "2";
  process.env.OPENROUTER_API_KEY = "openrouter-key";
  process.env.OPENROUTER_AUTOMATION_MODEL = "deepseek/deepseek-v4-flash";
  process.env.OPENROUTER_FREE_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
  delete process.env.CRON_SECRET;
  delete process.env.STEAM_PULSE_ENABLED;
  delete process.env.STEAM_PLAYER_COUNTS_ENABLED;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/automation/run");
});

describe("runAutomationMonitor", () => {
  it("selects a deterministic bounded 24 named plus 24 active auto semantic options with descriptions", async () => {
    const { selectSemanticClusterOptions } = await importRunner();
    const named = [
      {
        id: "named-recent",
        slug: "watch-recent",
        title: "Recent named cluster",
        category: "performance",
        description: "Recent named context.",
        last_signal_at: "2026-07-31T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "named-zeta",
        slug: "watch-zeta",
        title: "Zeta named cluster",
        category: "performance",
        description: "Zeta context.",
        last_signal_at: "2026-07-30T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "named-alpha",
        slug: "watch-alpha",
        title: "Alpha named cluster",
        category: "performance",
        description: "Alpha context.",
        last_signal_at: "2026-07-30T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `named-middle-${index}`,
        slug: `watch-middle-${String(index).padStart(2, "0")}`,
        title: `Named middle ${index}`,
        category: "performance",
        description: `Named middle description ${index}.`,
        last_signal_at: `2026-07-${String(29 - index).padStart(2, "0")}T12:00:00.000Z`,
        created_at: "2026-07-01T00:00:00.000Z",
      })),
      {
        id: "named-created-newer",
        slug: "watch-created-newer",
        title: "Created newer named cluster",
        category: "performance",
        description: "Used when no signal timestamp exists.",
        last_signal_at: null,
        created_at: "2026-07-05T00:00:00.000Z",
      },
      {
        id: "named-oldest",
        slug: "watch-oldest",
        title: "Oldest named cluster",
        category: "performance",
        description: "Must be excluded by the named option cap.",
        last_signal_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
      },
    ];
    const auto = Array.from({ length: 25 }, (_, index) => ({
      id: `auto-${index}`,
      slug: `auto-semantic-${String(index).padStart(2, "0")}`,
      title: `Auto semantic ${index}`,
      category: "performance",
      description: `Auto description ${index}.`,
      last_signal_at: `2026-07-${String(25 - index).padStart(2, "0")}T12:00:00.000Z`,
      created_at: "2026-07-01T00:00:00.000Z",
      admin_visibility_override: index <= 1 ? "force_hidden" : null,
      lifecycle_reason: index === 1 ? "Merged into auto-semantic-02 (duplicate)." : null,
    }));

    const options = selectSemanticClusterOptions([...named, ...auto]);
    const namedOptions = options.filter((option) => !option.slug.startsWith("auto-"));
    const autoOptions = options.filter((option) => option.slug.startsWith("auto-"));

    expect(namedOptions).toHaveLength(24);
    expect(autoOptions).toHaveLength(24);
    expect(namedOptions.slice(0, 3).map((option) => option.slug)).toEqual([
      "watch-recent",
      "watch-alpha",
      "watch-zeta",
    ]);
    expect(namedOptions.at(-1)?.slug).toBe("watch-created-newer");
    expect(namedOptions.map((option) => option.slug)).not.toContain("watch-oldest");
    expect(autoOptions.map((option) => option.slug)).toContain("auto-semantic-00");
    expect(autoOptions.map((option) => option.slug)).not.toContain("auto-semantic-01");
    expect(options[0]).toMatchObject({ slug: "watch-recent", description: "Recent named context." });
    expect(autoOptions[0]).toMatchObject({ slug: "auto-semantic-00", description: "Auto description 0." });
  });

  it("immediately restores automatic cluster and signal visibility after force-hidden is cleared", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          admin_visibility_override: null,
          auto_public: false,
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-fps",
          cluster_id: "cluster-fps",
          category: "performance",
          platform: "pc_steam",
          issue_title: "Frame-rate drops after patch 1.13.00",
          moderation_status: "approved",
        },
      ],
      source_signals: [
        {
          id: "signal-fps",
          cluster_id: "cluster-fps",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://old.reddit.com/r/CrimsonDesert/comments/fps/report",
          canonical_url: "https://old.reddit.com/r/CrimsonDesert/comments/fps/report",
          source_domain: "reddit.com",
          title: "Crimson Desert 1.13.00 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T11:00:00.000Z",
          source_published_at: "2026-07-05T11:00:00.000Z",
          public_status: "hidden",
          promotion_reason: "admin_force_hidden",
          extracted_facts: {},
        },
      ],
    });
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-fps", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({
      id: "cluster-fps",
      admin_visibility_override: null,
      auto_public: true,
      is_public: true,
    });
    expect(tables.source_signals[0]).toMatchObject({
      id: "signal-fps",
      public_status: "public",
      promotion_reason: "direct_report_match",
    });
  });

  it("keeps report-backed automatic eligibility while a force-hidden override is active", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          admin_visibility_override: "force_hidden",
          auto_public: false,
          is_public: false,
        },
      ],
      bug_reports: [
        {
          id: "report-fps",
          cluster_id: "cluster-fps",
          category: "performance",
          platform: "pc_steam",
          issue_title: "Frame-rate drops after patch 1.13.00",
          moderation_status: "approved",
        },
      ],
    });
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-fps", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({ auto_public: true, is_public: false });
  });

  it("advances the Auto baseline when evidence expires during a force-hidden period", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-expired",
          category: "performance",
          admin_visibility_override: "force_hidden",
          visibility_revision: 1,
          visibility_restore_is_public: true,
          visibility_restore_auto_public: true,
          auto_public: true,
          is_public: false,
        },
      ],
    });
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-expired", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({
      admin_visibility_override: "force_hidden",
      visibility_revision: 2,
      visibility_restore_is_public: false,
      visibility_restore_auto_public: false,
      auto_public: false,
      is_public: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_cluster_visibility_refresh",
      expect.objectContaining({ p_cluster_id: "cluster-expired", p_expected_revision: 1 }),
    );
  });

  it("does not mistake force-public for automatic eligibility", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-private",
          slug: "private_watchlist",
          title: "Private watchlist",
          category: "performance",
          description: "Below-threshold private watchlist.",
          admin_visibility_override: "force_public",
          auto_public: false,
          is_public: true,
        },
      ],
    });
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-private", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({ auto_public: false, is_public: true });
  });

  it("retries a stale force-public refresh after Auto changes the visibility revision", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-race",
          category: "performance",
          admin_visibility_override: "force_public",
          visibility_revision: 1,
          auto_public: false,
          is_public: true,
        },
      ],
      source_signals: [
        {
          id: "signal-race",
          cluster_id: "cluster-race",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://facebook.com/groups/crimsondesert/posts/fps-race",
          canonical_url: "https://facebook.com/groups/crimsondesert/posts/fps-race",
          source_domain: "facebook.com",
          title: "Crimson Desert 1.13.00 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T11:00:00.000Z",
          source_published_at: "2026-07-05T11:00:00.000Z",
          public_status: "private",
          promotion_reason: "below_threshold",
          extracted_facts: {},
        },
      ],
    });
    let transitionedToAuto = false;
    const transitionToAuto = () => {
      if (transitionedToAuto) return;
      transitionedToAuto = true;
      Object.assign(tables.issue_clusters[0], {
        admin_visibility_override: null,
        visibility_revision: 2,
        is_public: false,
      });
    };
    // Current direct writes reach the update hook; the fixed atomic implementation
    // reaches the RPC hook. Either way, Auto wins between the stale read and write.
    beforeUpdate = (table) => {
      if (table === "source_signals") transitionToAuto();
    };
    beforeVisibilityRefreshRpc = transitionToAuto;
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-race", new Date("2026-07-05T12:00:00.000Z"));

    expect(transitionedToAuto).toBe(true);
    expect(tables.issue_clusters[0]).toMatchObject({
      admin_visibility_override: null,
      visibility_revision: expect.any(Number),
      auto_public: false,
      is_public: false,
    });
    expect(tables.source_signals[0]).toMatchObject({
      public_status: "private",
      promotion_reason: "below_threshold",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_expected_revision)).toEqual([1, 2]);
  });

  it("does not overwrite transactional report promotion with a pre-revision report snapshot", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-report-race",
          category: "performance",
          admin_visibility_override: null,
          visibility_revision: 0,
          auto_public: false,
          is_public: false,
        },
      ],
    });
    beforeSelect = (table) => {
      if (table !== "issue_clusters") return;
      beforeSelect = null;
      tables.bug_reports.push({
        id: "report-race",
        cluster_id: "cluster-report-race",
        category: "performance",
        platform: "pc_steam",
        issue_title: "Approved while a refresh starts",
        moderation_status: "approved",
      });
      Object.assign(tables.issue_clusters[0], {
        visibility_revision: 1,
        auto_public: true,
        is_public: true,
      });
    };
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-report-race", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({
      visibility_revision: 2,
      direct_report_count: 1,
      auto_public: true,
      is_public: true,
    });
  });

  it("scheduled scans no longer report a Reddit lane at all", async () => {
    // The authenticated Reddit API is retired: a scan must not announce it as a
    // skipped source every run, and the historical ledger column stays at zero.
    process.env.REDDIT_CLIENT_ID = "legacy-id";
    process.env.REDDIT_CLIENT_SECRET = "legacy-secret";
    process.env.REDDIT_USER_AGENT = "legacy-agent";
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();
    try {
      const result = await runAutomationMonitor({
        mode: "scheduled",
        now: new Date("2026-07-05T12:00:00.000Z"),
      });

      expect(result.skips).not.toContain("reddit_disabled");
      expect(result.skips.some((skip) => skip.includes("reddit"))).toBe(false);
      expect(tables.automation_runs[0]).toMatchObject({ reddit_posts_seen: 0 });
    } finally {
      delete process.env.REDDIT_CLIENT_ID;
      delete process.env.REDDIT_CLIENT_SECRET;
      delete process.env.REDDIT_USER_AGENT;
    }
  });

  it("continues high-value LLM work after a normal accounted DeepSeek charge", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          is_public: true,
          admin_override: false,
        },
      ],
    });
    configureProviders();
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed intermittent frame-rate drops.", category: "performance" },
    ]);
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert patch 1.13 FPS drops in towns",
        url: "https://reddit.com/r/CrimsonDesert/comments/fps/towns",
        snippet: "Players report stutter and FPS drops after patch 1.13.00.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 combat stutter",
        url: "https://steamcommunity.com/app/3321460/discussions/stutter",
        snippet: "Players report combat stutter and FPS drops after patch 1.13.00.",
        sourceDomain: "steamcommunity.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    let extractionCall = 0;
    mocks.extractSignalWithOpenRouter.mockImplementation(async (candidate, options) => {
      extractionCall += 1;
      if (options.llmCallsRemaining > 0) openRouterAttempts += 1;
      return {
        issueTitle: candidate.title,
        category: "performance",
        platform: "pc_steam",
        confidence: "high",
        summary: candidate.snippet,
        clusterSlug: "performance_regression",
        extractionProvider: "openrouter",
        extractionModel: "deepseek/deepseek-v4-flash",
        llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
        llmCostUsd: extractionCall === 1 ? 0.0025 : 0,
      };
    });
    mocks.mapClaimToClusterWithOpenRouter.mockImplementation(async (_claim, _clusters, options) => {
      if (options.llmCallsRemaining > 0) openRouterAttempts += 1;
      return {
        matchKind: "none",
        clusterId: null,
        clusterSlug: null,
        reason: "No match.",
        llmCallsUsed: 0,
        llmCostUsd: 0,
        extractionModel: null,
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledTimes(2);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[0][1].llmCallsRemaining).toBeGreaterThan(0);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[1][1].llmCallsRemaining).toBeGreaterThan(0);
    expect(mocks.mapClaimToClusterWithOpenRouter).toHaveBeenCalledOnce();
    expect(mocks.mapClaimToClusterWithOpenRouter.mock.calls[0][2].llmCallsRemaining).toBeGreaterThan(0);
    expect(openRouterAttempts).toBe(3);
    expect(result.llmCostUsd).toBe(0.0025);
    expect(result.skips).not.toContain("openrouter_cost_unverified");
  });

  it("stops asking OpenRouter for the rest of the run once no provider matches", async () => {
    resetDb({});
    configureProviders();
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([]);
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert patch 1.13 FPS drops in towns",
        url: "https://reddit.com/r/CrimsonDesert/comments/fps/towns",
        snippet: "Players report stutter and FPS drops after patch 1.13.00.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 combat stutter",
        url: "https://steamcommunity.com/app/3321460/discussions/stutter",
        snippet: "Players report combat stutter and FPS drops after patch 1.13.00.",
        sourceDomain: "steamcommunity.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.extractSignalWithOpenRouter.mockImplementation(async (candidate, options) => {
      if (options.llmCallsRemaining > 0) openRouterAttempts += 1;
      return {
        issueTitle: candidate.title,
        category: "performance",
        platform: "pc_steam",
        confidence: "high",
        summary: candidate.snippet,
        clusterSlug: null,
        extractionProvider: "deterministic",
        extractionModel: null,
        llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
        llmCostUsd: 0,
        fallbackReason: "openrouter_no_route",
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).toContain("openrouter_no_route");
    // The second candidate is still processed — deterministically — but the run
    // stops offering it an LLM call, because the refusal will not change.
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledTimes(2);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[0][1].llmCallsRemaining).toBeGreaterThan(0);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[1][1].llmCallsRemaining).toBe(0);
    // Nothing reached a provider, so the month's ledger is untouched.
    expect(result.llmCostUsd).toBe(0);
    expect(result.skips).not.toContain("openrouter_cost_unverified");
  });

  it("reserves scheduled LLM allowance for scanner extraction after claim mapping", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          is_public: true,
          admin_override: false,
        },
      ],
    });
    configureProviders();
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        fixText: `Fixed performance issue ${index + 1}.`,
        category: "performance",
      })),
    );
    mocks.mapClaimToClusterWithOpenRouter.mockImplementation(async (_claim, _clusters, options) => ({
      matchKind: "none",
      clusterId: null,
      clusterSlug: null,
      reason: "No match.",
      llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
      llmCostUsd: 0,
      extractionModel: options.llmCallsRemaining > 0 ? "deepseek/deepseek-v4-flash" : null,
    }));
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "scheduled", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.mapClaimToClusterWithOpenRouter.mock.calls.some((call) => call[2].llmCallsRemaining > 0)).toBe(true);
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalled();
    expect(mocks.extractSignalWithOpenRouter.mock.calls[0][1].llmCallsRemaining).toBeGreaterThan(0);
  });

  it("opens the run-level circuit when claim mapping cannot verify cost", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          is_public: true,
          admin_override: false,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed frame-rate drops in towns.", category: "performance" },
      { fixText: "Fixed combat frame-rate drops.", category: "performance" },
    ]);
    let mappingCall = 0;
    mocks.mapClaimToClusterWithOpenRouter.mockImplementation(async (_claim, _clusters, options) => {
      mappingCall += 1;
      if (options.llmCallsRemaining > 0) openRouterAttempts += 1;
      return {
        matchKind: "none",
        clusterId: null,
        clusterSlug: null,
        reason: mappingCall === 1 ? "OpenRouter cost could not be verified." : "No match.",
        llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
        llmCostUsd: 0,
        extractionModel: options.llmCallsRemaining > 0 ? "deepseek/deepseek-v4-flash" : null,
        ...(mappingCall === 1 ? { skipReason: "openrouter_cost_unverified" as const } : {}),
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.mapClaimToClusterWithOpenRouter).toHaveBeenCalledTimes(2);
    expect(mocks.mapClaimToClusterWithOpenRouter.mock.calls[0][2].llmCallsRemaining).toBeGreaterThan(0);
    expect(mocks.mapClaimToClusterWithOpenRouter.mock.calls[1][2].llmCallsRemaining).toBe(0);
    expect(openRouterAttempts).toBe(1);
    expect(result.llmCostUsd).toBe(0);
    expect(result.skips).toContain("openrouter_cost_unverified");
  });

  it("stops mapping later claims once one claim hits a routing refusal", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          is_public: true,
          admin_override: false,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed frame-rate drops in towns.", category: "performance" },
      { fixText: "Fixed combat frame-rate drops.", category: "performance" },
    ]);
    let mappingCall = 0;
    mocks.mapClaimToClusterWithOpenRouter.mockImplementation(async (_claim, _clusters, options) => {
      mappingCall += 1;
      if (options.llmCallsRemaining > 0) openRouterAttempts += 1;
      return {
        matchKind: "none",
        clusterId: null,
        clusterSlug: null,
        reason: mappingCall === 1 ? "No OpenRouter provider matched the limits." : "No match.",
        llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
        llmCostUsd: 0,
        extractionModel: options.llmCallsRemaining > 0 ? "deepseek/deepseek-v4-flash" : null,
        ...(mappingCall === 1 ? { skipReason: "openrouter_no_route" as const } : {}),
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // The refusal has to reach result.skips, or the loop hands every remaining
    // claim to the same route that just refused one.
    expect(result.skips).toContain("openrouter_no_route");
    expect(mocks.mapClaimToClusterWithOpenRouter.mock.calls[1][2].llmCallsRemaining).toBe(0);
    expect(openRouterAttempts).toBe(1);
    // Still not a circuit reason: nothing was spent and nothing is unverified.
    expect(result.skips).not.toContain("openrouter_cost_unverified");
    expect(result.llmCostUsd).toBe(0);
  });

  it("keeps the current-month LLM circuit open across later runs", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-charged-free-model",
          started_at: "2026-07-04T12:00:00.000Z",
          finished_at: "2026-07-04T12:01:00.000Z",
          estimated_cost_usd: 0.0025,
          search_queries_used: 0,
          mode: "scheduled",
          status: "success",
          skips: ["openrouter_unexpected_charge"],
        },
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.tavilySearch).toHaveBeenCalledTimes(5);
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledTimes(2);
    expect(mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining === 0)).toBe(true);
    expect(openRouterAttempts).toBe(0);
    expect(result.llmCallsUsed).toBe(0);
    expect(result.llmCostUsd).toBe(0);
    expect(result.skips).toContain("openrouter_circuit_open");
    expect(tables.automation_runs[0]).toMatchObject({
      estimated_cost_usd: 0.0025,
      skips: ["openrouter_unexpected_charge"],
    });
    expect(tables.automation_runs[1]).toMatchObject({
      skips: expect.arrayContaining(["openrouter_circuit_open"]),
    });
  });

  it("does not latch the monthly circuit on a single cost-unverified run", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-single-blip",
          started_at: "2026-07-05T09:00:00.000Z",
          finished_at: "2026-07-05T09:01:00.000Z",
          estimated_cost_usd: 0.016,
          search_queries_used: 2,
          mode: "scheduled",
          status: "success",
          skips: ["openrouter_cost_unverified"],
        },
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalled();
    expect(
      mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining > 0),
    ).toBe(true);
    expect(result.skips).not.toContain("openrouter_circuit_open");
  });

  it("latches the monthly circuit when three cost-unverified runs land inside 24 hours", async () => {
    const blipRun = (id: string, startedAt: string) => ({
      id,
      started_at: startedAt,
      finished_at: startedAt,
      estimated_cost_usd: 0.016,
      search_queries_used: 2,
      mode: "scheduled",
      status: "success",
      skips: ["openrouter_cost_unverified"],
    });
    resetDb({
      automation_runs: [
        blipRun("run-blip-1", "2026-07-05T02:00:00.000Z"),
        blipRun("run-blip-2", "2026-07-04T20:00:00.000Z"),
        blipRun("run-blip-3", "2026-07-04T14:00:00.000Z"),
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(
      mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining === 0),
    ).toBe(true);
    expect(result.llmCallsUsed).toBe(0);
    expect(result.skips).toContain("openrouter_circuit_open");
  });

  it("counts cost-unverified runs across a UTC month boundary inside the 24-hour window", async () => {
    const blipRun = (id: string, startedAt: string) => ({
      id,
      started_at: startedAt,
      finished_at: startedAt,
      estimated_cost_usd: 0.016,
      search_queries_used: 2,
      mode: "scheduled",
      status: "success",
      skips: ["openrouter_cost_unverified"],
    });
    // Two blips late on June 30, one early on July 1 — all inside 24h of "now".
    resetDb({
      automation_runs: [
        blipRun("run-blip-june-1", "2026-06-30T20:00:00.000Z"),
        blipRun("run-blip-june-2", "2026-06-30T23:00:00.000Z"),
        blipRun("run-blip-july", "2026-07-01T02:00:00.000Z"),
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-01T10:00:00.000Z") });

    expect(
      mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining === 0),
    ).toBe(true);
    expect(result.skips).toContain("openrouter_circuit_open");
  });

  it("keeps monthly spend accounting month-scoped even when the circuit read crosses the boundary", async () => {
    // A pricey June run inside the 24h read window must not count against July's budget.
    resetDb({
      automation_runs: [
        {
          id: "run-june-spend",
          started_at: "2026-06-30T20:00:00.000Z",
          finished_at: "2026-06-30T20:01:00.000Z",
          estimated_cost_usd: 1.5,
          search_queries_used: 2,
          mode: "scheduled",
          status: "success",
          skips: [],
        },
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-01T10:00:00.000Z") });

    expect(result.skips).not.toContain("openrouter_circuit_open");
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalled();
    expect(
      mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining > 0),
    ).toBe(true);
  });

  it("ignores cost-unverified runs older than 24 hours when deciding the circuit", async () => {
    const blipRun = (id: string, startedAt: string) => ({
      id,
      started_at: startedAt,
      finished_at: startedAt,
      estimated_cost_usd: 0.016,
      search_queries_used: 2,
      mode: "scheduled",
      status: "success",
      skips: ["openrouter_cost_unverified"],
    });
    resetDb({
      automation_runs: [
        blipRun("run-stale-1", "2026-07-04T06:00:00.000Z"),
        blipRun("run-stale-2", "2026-07-03T12:00:00.000Z"),
        blipRun("run-stale-3", "2026-07-02T12:00:00.000Z"),
      ],
    });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalled();
    expect(
      mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining > 0),
    ).toBe(true);
    expect(result.skips).not.toContain("openrouter_circuit_open");
  });

  it("dry run writes only an automation_runs ledger row", async () => {
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "dry_run", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.searchResultsSeen).toBe(5);
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      mode: "dry_run",
      signals_inserted: 0,
      funnel: expect.objectContaining({ kept: 2, prepared: 2, persisted: 0 }),
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
        modelPreset: "gpt_5_6_luna",
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    // The point of the rotation is that two adjacent one-credit scans do not spend
    // their single credit on the same question. Asserting the property rather than a
    // slot index: which slot an offset lands on is a function of pack length, and the
    // pack is expected to change as the bake-off measures new queries.
    const [firstQuery] = mocks.tavilySearch.mock.calls[0] as [string];
    const [secondQuery] = mocks.tavilySearch.mock.calls[1] as [string];

    expect(firstQuery).not.toBe(secondQuery);
    expect(firstQuery).toContain("1.13.00");
    expect(secondQuery).toContain("1.13.00");
  });

  it("budget 0 still runs Tavily and deterministic extraction without paid LLM calls", async () => {
    resetDb({ automation_settings: [{ key: "scanner", value: { monthlyLlmUsdCap: 0 } }] });
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).not.toContain("budget_zero");
    expect(result.searchQueriesUsed).toBe(5);
    expect(result.searchResultsSeen).toBe(5);
    expect(result.llmCallsUsed).toBe(0);
    expect(openRouterAttempts).toBe(0);
    expect(mocks.tavilySearch).toHaveBeenCalledTimes(5);
    expect(sourceSignalRows()).toHaveLength(2);
    expect(sourceSignalRows()[0]).toMatchObject({ source: "web_search", extraction_provider: "deterministic" });
  });

  it.each([
    ["an unlimited key", { data: { limit: null, limit_remaining: null, limit_reset: null, usage_monthly: 0 } }, "openrouter_key_limit_unsafe"],
    ["a daily key", { data: { limit: 1, limit_remaining: 1, limit_reset: "daily", usage_monthly: 0 } }, "openrouter_key_limit_unsafe"],
    ["an unreadable key response", { unexpected: true }, "openrouter_key_budget_unverified"],
  ])("refuses paid model calls for %s", async (_label, keyResponse, reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(keyResponse)));
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).toContain(reason);
    expect(openRouterAttempts).toBe(0);
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalled();
    expect(mocks.extractSignalWithOpenRouter.mock.calls.every((call) => call[1].llmCallsRemaining === 0)).toBe(true);
  });

  it("an exhausted Tavily cap still runs free patch maintenance without web discovery", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(result.status).toBe("success");
    expect(result.skips).toContain("tavily_credit_cap");
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs).toHaveLength(2);
    expect(tables.automation_runs[1]).toMatchObject({
      status: "success",
      mode: "scheduled",
      skips: expect.arrayContaining(["tavily_credit_cap"]),
    });
  });

  it("historical LLM spend at the cap stops DeepSeek while Tavily and maintenance continue", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(result.status).toBe("success");
    expect(result.skips).toContain("llm_budget_capped");
    expect(mocks.tavilySearch).toHaveBeenCalledOnce();
    expect(openRouterAttempts).toBe(0);
    expect(tables.automation_runs[1]).toMatchObject({
      status: "success",
      mode: "scheduled",
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
      extraction_model: "deepseek/deepseek-v4-flash",
    });
  });

  it("reuses an orphan deterministic auto-cluster without overwriting its metadata", async () => {
    const semantic = semanticFingerprint("FPS regression since 1.13", "performance");
    const slug = `auto-${hashValue(semantic).slice(0, 12)}`;
    resetDb({
      issue_clusters: [
        {
          id: "orphan-auto",
          slug,
          title: "Operator-curated orphan title",
          category: "performance",
          description: "Operator-curated orphan description.",
          fix_status: "fix_claimed",
          confidence: "high",
          is_public: true,
          auto_public: true,
          admin_visibility_override: "force_hidden",
          visibility_revision: 4,
          signal_count: 0,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "FPS drops since 1.13",
        url: "https://example.com/orphan-fps",
        snippet: "Players report Crimson Desert FPS drops and stutter on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.signalsInserted).toBe(1);
    expect(tables.issue_clusters).toHaveLength(1);
    expect(tables.issue_clusters[0]).toMatchObject({
      id: "orphan-auto",
      slug,
      title: "Operator-curated orphan title",
      description: "Operator-curated orphan description.",
      fix_status: "fix_claimed",
      admin_visibility_override: "force_hidden",
      signal_count: 1,
    });
    expect(sourceSignalRows()[0]).toMatchObject({ cluster_id: "orphan-auto" });
  });

  it("recovers from a concurrent deterministic auto-cluster slug conflict", async () => {
    const semantic = semanticFingerprint("FPS regression since 1.13", "performance");
    const slug = `auto-${hashValue(semantic).slice(0, 12)}`;
    issueClusterInsertRace = {
      slug,
      row: {
        id: "raced-auto",
        slug,
        title: "Concurrent winner",
        category: "performance",
        description: "Created by the competing scan.",
        fix_status: "reported",
        confidence: "medium",
        is_public: false,
        auto_public: false,
        visibility_revision: 0,
      },
    };
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "FPS drops since 1.13",
        url: "https://example.com/raced-fps",
        snippet: "Players report Crimson Desert FPS drops and stutter on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.signalsInserted).toBe(1);
    expect(tables.issue_clusters).toHaveLength(1);
    expect(tables.issue_clusters[0]).toMatchObject({ id: "raced-auto", slug, title: "Concurrent winner" });
    expect(sourceSignalRows()[0]).toMatchObject({ cluster_id: "raced-auto" });
  });

  it("refreshes both clusters when an existing signal is reclassified", async () => {
    const url = "https://example.com/reclassified-fps";
    resetDb({
      issue_clusters: [
        {
          id: "old-cluster",
          slug: "manual-old-cluster",
          title: "Old cluster",
          category: "other",
          description: "The signal used to live here.",
          fix_status: "reported",
          confidence: "medium",
          is_public: false,
          auto_public: false,
          signal_count: 1,
          visibility_revision: 0,
        },
      ],
      source_signals: [
        {
          id: "signal-to-reclassify",
          source: "web_search",
          source_type: "web_search",
          source_url: url,
          canonical_url: url,
          external_id_hash: externalIdHash("web_search", url),
          title: "Earlier classification",
          summary: "Players report a current-patch performance problem.",
          source_domain: "example.com",
          source_published_at: "2026-07-04T12:00:00.000Z",
          semantic_fingerprint: "old-semantic",
          cluster_id: "old-cluster",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-07-05T11:00:00.000Z",
          public_status: "private",
          seen_count: 1,
          first_seen_at: "2026-07-05T11:00:00.000Z",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "FPS drops since 1.13",
        url,
        snippet: "Players report Crimson Desert FPS drops and stutter on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    const newCluster = tables.issue_clusters.find((row) => row.id !== "old-cluster");
    expect(result.status).toBe("success");
    expect(result.signalsInserted).toBe(0);
    expect(result.signalsReobserved).toBe(1);
    expect(newCluster).toBeDefined();
    expect(tables.issue_clusters.find((row) => row.id === "old-cluster")).toMatchObject({ signal_count: 0 });
    expect(newCluster).toMatchObject({ signal_count: 1 });
    expect(sourceSignalRows()[0]).toMatchObject({ cluster_id: newCluster!.id });
  });

  it("reports only successfully persisted signals after a partial batch failure", async () => {
    sourceSignalInsertFailure = { title: "FPS drops second", message: "source signal write failed" };
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "FPS drops first",
        url: "https://example.com/partial-first",
        snippet: "Players report Crimson Desert FPS drops and stutter on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
      {
        title: "FPS drops second",
        url: "https://example.com/partial-second",
        snippet: "Players report Crimson Desert FPS drops and stutter on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });
    const ledger = tables.automation_runs[0];

    expect(result.status).toBe("partial");
    expect(result.signalsPrepared).toBe(2);
    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()).toHaveLength(1);
    expect(tables.issue_clusters[0]).toMatchObject({ signal_count: 1 });
    expect(ledger).toMatchObject({
      status: "partial",
      signals_inserted: 1,
      funnel: expect.objectContaining({ kept: 2, prepared: 2, persisted: 1 }),
    });
  });

  it("direct approved reports promote a matching one-source signal", async () => {
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Map crash on PS5",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-map/map",
        snippet: "Map crash still happens on PS5.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Map crash on PS5",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-map/map",
        snippet: "Map crash still happens on PS5.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
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

  it("keeps a fresh publishable signal hidden under a force-hidden cluster", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-map",
          slug: "map-crash",
          title: "Map crash on PS5",
          category: "crash_startup",
          description: "Admin has force-hidden this cluster.",
          fix_status: "reported",
          confidence: "low",
          is_public: true,
          admin_visibility_override: "force_hidden",
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
    // A fresh (post-patch) current-patch signal that is publishable on its own,
    // routed onto a cluster an admin has force-hidden. force_hidden must win at the
    // per-signal level too: the signal stays hidden rather than being downgraded to
    // private (which would leak it back into the private-signal targeting pool).
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

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-map",
      public_status: "hidden",
      promotion_reason: "admin_force_hidden",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      public_signal_count: 0,
      auto_public: true,
      is_public: false,
    });
  });

  it("counts duplicate approved excerpts as one verified report per report", async () => {
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Map crash on PS5",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-map/map",
        snippet: "Map crash still happens on PS5.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      verified_report_count: 1,
    });
  });

  it("does not promote two fresh distinct canonical URLs on the same domain (not independent)", async () => {
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

  it("keeps an operator-blocked URL hidden and excludes it from corroboration", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-feedback",
          slug: "operator-feedback",
          title: "Operator feedback cluster",
          category: "performance",
          admin_visibility_override: null,
          visibility_revision: 0,
          auto_public: false,
          is_public: false,
        },
      ],
      scanner_feedback_rules: [
        {
          id: "rule-pubg",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/abc/guerilla_warfare",
          created_at: "2026-07-05T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
      source_signals: [
        {
          id: "signal-pubg",
          cluster_id: "cluster-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/abc/guerilla_warfare?utm_source=search",
          canonical_url: null,
          source_domain: "reddit.com",
          title: "Crimson Desert trading wagon request",
          summary: "A search snippet mentions Crimson Desert, but the source is PUBG.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
        {
          id: "signal-real",
          cluster_id: "cluster-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://community.example.com/crimson-desert-fps",
          canonical_url: "https://community.example.com/crimson-desert-fps",
          source_domain: "community.example.com",
          title: "Crimson Desert 1.13 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
      ],
    });
    honorSourceSignalProjection = true;
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-feedback", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.source_signals.find((row) => row.id === "signal-pubg")).toMatchObject({
      public_status: "hidden",
      promotion_reason: "operator_feedback_blocked",
    });
    expect(tables.source_signals.find((row) => row.id === "signal-real")).toMatchObject({
      public_status: "private",
      promotion_reason: "below_threshold",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 0,
      auto_public: false,
      is_public: false,
    });
  });

  it("uses broad feedback rules for future intake without changing retained evidence", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-broad-feedback",
          slug: "broad-feedback",
          title: "Broad feedback cluster",
          category: "performance",
          admin_visibility_override: null,
          visibility_revision: 0,
          auto_public: true,
          is_public: true,
        },
      ],
      scanner_feedback_rules: [
        {
          id: "rule-reddit-domain",
          action: "block",
          decision: "off_topic",
          scope_type: "source_domain",
          scope_value: "reddit.com",
          created_at: "2026-07-05T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
      source_signals: [
        {
          id: "signal-reddit-retained",
          cluster_id: "cluster-broad-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/fps_drops",
          canonical_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/fps_drops",
          source_domain: "reddit.com",
          title: "Crimson Desert 1.13 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
        {
          id: "signal-community-retained",
          cluster_id: "cluster-broad-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://community.example.com/crimson-desert-fps",
          canonical_url: "https://community.example.com/crimson-desert-fps",
          source_domain: "community.example.com",
          title: "Crimson Desert performance regression",
          summary: "A second community reports frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
      ],
    });
    honorSourceSignalProjection = true;
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-broad-feedback", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.source_signals.find((row) => row.id === "signal-reddit-retained")).toMatchObject({
      public_status: "public",
      promotion_reason: "two_independent_domains_trusted",
    });
    expect(tables.source_signals.find((row) => row.id === "signal-community-retained")).toMatchObject({
      public_status: "public",
      promotion_reason: "two_independent_domains_trusted",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 2,
      auto_public: true,
      is_public: true,
    });
  });

  it("keeps an exact reviewed record out of evidence after canonicalization widens", async () => {
    // The operator reviewed this exact Steam record and blocked it. Both the
    // stored signal and the rule carry the `?l=english` form that was canonical
    // when they were written. Canonicalizing only the signal would stop the
    // block matching, put it back in the evidence count, and republish the
    // cluster — a learning rule rewriting evidence, which it may never do.
    const reviewed = "https://steamcommunity.com/app/3321460/discussions/0/8057?l=english";
    resetDb({
      issue_clusters: [
        {
          id: "cluster-exact-reviewed",
          slug: "exact-reviewed",
          title: "Exact reviewed cluster",
          category: "performance",
          admin_visibility_override: null,
          visibility_revision: 0,
          auto_public: true,
          is_public: true,
        },
      ],
      scanner_feedback_rules: [
        {
          id: "rule-steam-exact",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: reviewed,
          created_at: "2026-07-05T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
      source_signals: [
        {
          id: "signal-steam-reviewed",
          cluster_id: "cluster-exact-reviewed",
          source: "web_search",
          source_type: "web_search",
          source_url: reviewed,
          canonical_url: reviewed,
          source_domain: "steamcommunity.com",
          title: "Crimson Desert 1.13 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
        {
          id: "signal-community-retained",
          cluster_id: "cluster-exact-reviewed",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://community.example.com/crimson-desert-fps",
          canonical_url: "https://community.example.com/crimson-desert-fps",
          source_domain: "community.example.com",
          title: "Crimson Desert performance regression",
          summary: "A second community reports frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
      ],
    });
    honorSourceSignalProjection = true;
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-exact-reviewed", new Date("2026-07-05T12:00:00.000Z"));

    // One publishable domain left, so corroboration is not met and the cluster
    // no longer qualifies on its own evidence.
    expect(tables.issue_clusters[0]).toMatchObject({ auto_public: false });
  });

  it("keeps a broad rule read past the hosted row cap out of retained evidence", async () => {
    // Paging the rule ledger to completion makes MORE rules visible to every
    // consumer, including the evidence refresh. The refresh narrows itself to
    // exact-URL rules on purpose, so a broad domain lesson that only becomes
    // reachable on page two still must not rewrite stored evidence counts or
    // demote a cluster.
    resetDb({
      issue_clusters: [
        {
          id: "cluster-broad-feedback",
          slug: "broad-feedback",
          title: "Broad feedback cluster",
          category: "performance",
          admin_visibility_override: null,
          visibility_revision: 0,
          auto_public: true,
          is_public: true,
        },
      ],
      scanner_feedback_rules: [
        // Two newer rules share a timestamp and fill the first page.
        { id: "rule-filler-b", action: "block", decision: "off_topic", scope_type: "source_domain", scope_value: "unrelated-b.example", created_at: "2026-07-05T11:30:00.000Z", expires_at: null, revoked_at: null },
        { id: "rule-filler-a", action: "block", decision: "off_topic", scope_type: "source_domain", scope_value: "unrelated-a.example", created_at: "2026-07-05T11:30:00.000Z", expires_at: null, revoked_at: null },
        {
          id: "rule-reddit-domain",
          action: "block",
          decision: "off_topic",
          scope_type: "source_domain",
          scope_value: "reddit.com",
          created_at: "2026-07-05T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
      source_signals: [
        {
          id: "signal-reddit-retained",
          cluster_id: "cluster-broad-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/fps_drops",
          canonical_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/fps_drops",
          source_domain: "reddit.com",
          title: "Crimson Desert 1.13 FPS drops",
          summary: "Players report frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
        {
          id: "signal-community-retained",
          cluster_id: "cluster-broad-feedback",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://community.example.com/crimson-desert-fps",
          canonical_url: "https://community.example.com/crimson-desert-fps",
          source_domain: "community.example.com",
          title: "Crimson Desert performance regression",
          summary: "A second community reports frame-rate drops after patch 1.13.00.",
          category: "performance",
          confidence: "high",
          observed_at: "2026-07-05T10:00:00.000Z",
          source_published_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
          extracted_facts: {},
        },
      ],
    });
    hostedRowCap = { table: "scanner_feedback_rules", rows: 2 };
    honorSourceSignalProjection = true;
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-broad-feedback", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.source_signals.find((row) => row.id === "signal-reddit-retained")).toMatchObject({
      public_status: "public",
      promotion_reason: "two_independent_domains_trusted",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 2,
      auto_public: true,
      is_public: true,
    });
  });

  it("stores rejected candidates through the legacy schema when feedback columns are missing", async () => {
    insertFailure = {
      table: "automation_rejected_candidates",
      column: "feedback_rule_id",
      code: "PGRST204",
      message: "Could not find the feedback_rule_id column of automation_rejected_candidates in the schema cache",
    };
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/legacy-reject",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.status).not.toBe("failed");
    expect(result.errors).not.toContain(expect.stringContaining("rejected candidates insert failed"));
    expect(rejectedCandidateRows()).toEqual([
      expect.objectContaining({ url: "https://example.com/legacy-reject", reason: "source_not_issue_report" }),
    ]);
    expect(rejectedCandidateRows()[0]).not.toHaveProperty("feedback_rule_id");
  });

  it("refreshes a legacy rejected candidate without the feedback column", async () => {
    resetDb({
      automation_rejected_candidates: [
        {
          id: "legacy-rejected",
          run_id: "old-run",
          title: "Old title",
          url: "https://example.com/legacy-refresh",
          source_domain: "example.com",
          snippet: "Old snippet",
          reason: "source_not_issue_report",
          created_at: "2026-07-20T12:00:00.000Z",
          expires_at: "2026-07-29T12:00:00.000Z",
          rescued_at: null,
        },
      ],
    });
    updateFailure = {
      table: "automation_rejected_candidates",
      column: "feedback_rule_id",
      code: "PGRST204",
      message: "Could not find the feedback_rule_id column of automation_rejected_candidates in the schema cache",
    };
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/legacy-refresh",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.status).not.toBe("failed");
    expect(rejectedCandidateRows()).toHaveLength(1);
    expect(rejectedCandidateRows()[0]).toMatchObject({
      id: "legacy-rejected",
      title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
      run_id: tables.automation_runs[0].id,
    });
    expect(rejectedCandidateRows()[0]).not.toHaveProperty("feedback_rule_id");
  });

  it("blocks a normally relevant candidate when an operator feedback rule matches", async () => {
    resetDb({
      scanner_feedback_rules: [
        {
          id: "rule-protonmail",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp",
          created_at: "2026-07-22T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
    });
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert crashes after the update",
        url: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp?utm_source=search",
        snippet: "Crimson Desert crashes every time I open the map.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(1);
    expect(result.skips).toContain("operator_rule_blocked");
    expect(result.signalsInserted).toBe(0);
    expect(rejectedCandidateRows()).toEqual([
      expect.objectContaining({
        reason: "off_topic",
        feedback_rule_id: "rule-protonmail",
      }),
    ]);
    expect(tables.automation_runs[0]).toMatchObject({ operator_rules_matched: 1 });
  });

  it("still enforces a Steam rule recorded under a different interface language", async () => {
    // The rule was canonical when it was written; `l` only became droppable
    // later. Intake re-canonicalizes stored scopes so the lesson keeps naming
    // the page it was about — otherwise a rejected thread returns to the desk
    // under any other language.
    resetDb({
      scanner_feedback_rules: [
        {
          id: "rule-steam-thread",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: "https://steamcommunity.com/app/3321460/discussions/0/8057?l=english",
          created_at: "2026-07-22T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
    });
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert crashes after the update",
        url: "https://steamcommunity.com/app/3321460/discussions/0/8057?l=koreana",
        snippet: "Crimson Desert crashes every time I open the map.",
        sourceDomain: "steamcommunity.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(1);
    expect(result.skips).toContain("operator_rule_blocked");
    expect(result.signalsInserted).toBe(0);
    expect(rejectedCandidateRows()).toEqual([
      expect.objectContaining({ reason: "off_topic", feedback_rule_id: "rule-steam-thread" }),
    ]);
  });

  it("keeps enforcing an older rule that sits past the hosted row cap", async () => {
    // Three newer rules share one timestamp, so the tie lands on the page
    // boundary; the rule that actually matches this candidate is older and can
    // only be reached by walking past a short page.
    const tied = "2026-07-22T11:30:00.000Z";
    resetDb({
      scanner_feedback_rules: [
        { id: "rule-tied-c", action: "block", decision: "off_topic", scope_type: "source_domain", scope_value: "example.com", created_at: tied, expires_at: null, revoked_at: null },
        { id: "rule-tied-b", action: "block", decision: "off_topic", scope_type: "source_domain", scope_value: "example.net", created_at: tied, expires_at: null, revoked_at: null },
        { id: "rule-tied-a", action: "block", decision: "off_topic", scope_type: "source_domain", scope_value: "example.org", created_at: tied, expires_at: null, revoked_at: null },
        {
          id: "rule-protonmail",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp",
          created_at: "2026-07-22T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
    });
    hostedRowCap = { table: "scanner_feedback_rules", rows: 2 };
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert crashes after the update",
        url: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp?utm_source=search",
        snippet: "Crimson Desert crashes every time I open the map.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(1);
    expect(result.skips).toContain("operator_rule_blocked");
    expect(result.signalsInserted).toBe(0);
    expect(rejectedCandidateRows()).toEqual([
      expect.objectContaining({ reason: "off_topic", feedback_rule_id: "rule-protonmail" }),
    ]);
  });

  it("evaluates feedback-rule expiry against the scan clock instead of the source timestamp", async () => {
    resetDb({
      scanner_feedback_rules: [
        {
          id: "rule-expired",
          action: "block",
          decision: "off_topic",
          scope_type: "exact_url",
          scope_value: "https://example.com/crimson-desert-map-crash",
          created_at: "2026-07-01T11:00:00.000Z",
          expires_at: "2026-07-10T12:00:00.000Z",
          revoked_at: null,
        },
      ],
    });
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert crashes when opening the map",
        url: "https://example.com/crimson-desert-map-crash",
        snippet: "Crimson Desert crashes every time I open the map after patch 1.13.00.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.extractSignalWithOpenRouter.mockResolvedValue({
      issueTitle: "Map crash after patch",
      category: "crash_startup",
      platform: "pc_steam",
      confidence: "medium",
      summary: "Players report a map crash after patch 1.13.00.",
      clusterSlug: null,
      extractionProvider: "deterministic",
      extractionModel: null,
      llmCallsUsed: 0,
      llmCostUsd: 0,
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(0);
    expect(result.skips).not.toContain("operator_rule_blocked");
    expect(result.signalsInserted).toBe(1);
  });

  it("keeps legacy scanning active when the feedback-rules table is not migrated yet", async () => {
    selectFailure = {
      table: "scanner_feedback_rules",
      message: "relation scanner_feedback_rules does not exist",
    };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.status).not.toBe("failed");
    expect(result.errors).not.toContain(expect.stringContaining("feedback rules"));
  });

  it("lets a Relevant exact-URL rule bypass the automated relevance rejection", async () => {
    resetDb({
      scanner_feedback_rules: [
        {
          id: "rule-manual-relevant",
          action: "allow",
          decision: "relevant",
          scope_type: "exact_url",
          scope_value: "https://example.com/operator-reviewed-page",
          created_at: "2026-07-22T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
    });
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch notes",
        url: "https://example.com/operator-reviewed-page",
        snippet: "Operator verified this page contains a real crash report.",
        sourceDomain: "example.com",
        observedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.extractSignalWithOpenRouter.mockResolvedValue({
      issueTitle: "Map crash after patch",
      category: "crash_startup",
      platform: "pc_steam",
      confidence: "medium",
      summary: "A reviewed source reports a map crash after the patch.",
      clusterSlug: null,
      extractionProvider: "deterministic",
      extractionModel: null,
      llmCallsUsed: 0,
      llmCostUsd: 0,
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(1);
    expect(result.skips).toContain("operator_rule_allowed");
    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({ title: "Crimson Desert patch notes" });
  });

  it("dry runs record zero rejected candidates even when candidates fail pre-screen", async () => {
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

  it("never spends a recon fetch on an official page whose verdict is already fixed", async () => {
    // A publisher known-issues notice qualifies for the recon lane on every axis
    // the borderline check reads — trusted domain, current patch, "players" and
    // "issue" context cues — but rescue is impossible by construction: the
    // re-screen routes official domains straight back to the observation lane
    // whatever the fetched text says, so the credit must never be booked.
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 known issues notice",
        snippet:
          "Players report the quest cannot progress and the game crashes when riding a bear. We are aware of the issue.",
        url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
        sourceDomain: "crimsondesert.pearlabyss.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue("must never be requested");
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.tavilyExtract).not.toHaveBeenCalled();
    expect(result.candidatesRescued).toBe(0);
    // Never a signal — official pages are provider context, not player evidence.
    expect(sourceSignalRows()).toHaveLength(0);
  });

  it("stores an operator-rescued official page without minting a cluster", async () => {
    // Rescue deliberately skips the pre-screen — the admin has judged the page
    // relevant, and the signal is stored. The clustering boundary must still
    // hold: provider content may support an existing cluster, but it never
    // creates a durable cluster title of its own.
    resetDb();
    configureProviders();
    const { rescueCandidateSignal } = await importRunner();
    const { createServiceClient } = await import("@/lib/supabase");

    await rescueCandidateSignal(createServiceClient() as never, {
      title: "Crimson Desert – Known Issues",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
      sourceDomain: "crimsondesert.pearlabyss.com",
      sourcePublishedAt: "2026-07-05T10:00:00.000Z",
      snippet: "Quest cannot progress after the cutscene. The game crashes when riding a bear.",
    });

    expect(tables.issue_clusters).toHaveLength(0);
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: null,
      source_domain: "crimsondesert.pearlabyss.com",
      public_status: "private",
    });
    // The ledger names the caveat instead of reporting an unqualified success.
    expect(tables.automation_runs.at(-1)?.skips).toContain("provider_context_no_cluster");
  });

  it("caps recon fetches per run and falls back to snippet-only for the overflow", async () => {
    // Four borderline trusted current-patch candidates, each thin. MAX_RECON_FETCHES_PER_RUN is 2.
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

    // At most two recon fetches; the remaining two candidates fall back to snippet-only borderline.
    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(2);
    expect(result.skips.filter((skip) => skip === "candidate_recon")).toHaveLength(2);
    expect(result.status).not.toBe("failed");
    // Ledger: exactly two recon credits booked (the overflow candidates book none).
    const reconFetches = mocks.tavilyExtract.mock.calls.length;
    expect(reconFetches).toBe(2);
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued + reconFetches);
    expect(result.estimatedCostUsd).toBeCloseTo(result.searchQueriesUsed * 0.008 + result.llmCostUsd, 10);
    // The two recon-rescued candidates are kept; the overflow ones still run the
    // old snippet-only borderline extract (which also keeps under the default mock).
    expect(result.candidatesRescued).toBe(4);
    expect(sourceSignalRows()).toHaveLength(4);
  });

  it("does not recon-fetch a non-trusted borderline candidate", async () => {
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

  it("allows free-tier recon when the dollar budget is zero", async () => {
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "0";
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-borderline/current_patch",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00.",
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.skips).not.toContain("budget_zero");
    expect(mocks.tavilyExtract).toHaveBeenCalledOnce();
    expect(result.skips).toContain("candidate_recon");
  });

  it("does not book a phantom recon credit when Tavily is unconfigured but paid search is allowed", async () => {
    // The phantom-charge bug: allowPaidSearch stays true (budget-driven), but with
    // TAVILY_API_KEY unset tavilyExtract makes ZERO network calls and returns null.
    // Recon must be gated on features().webSearch so it never books a credit here.
    const savedKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    // A trusted reddit.com borderline current-patch candidate arrives via Reddit
    // (web search can't run without the key, but Reddit still can).
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

  it("books no recon credit when the source refuses the fetch", async () => {
    // Reddit refuses Tavily's fetcher: the extract endpoint answers 200 with the URL
    // in failed_results, so tavilyExtract returns null and NOTHING throws. Booking the
    // credit before the call therefore charged the ledger and spent a search query on
    // page text that never arrived. reddit.com is the first trusted domain, so this
    // was the ordinary path, not an edge case.
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon-refused/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(null);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // The lane ran and is reported as having run...
    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(1);
    expect(result.skips).toContain("candidate_recon");
    // ...and says plainly that the source gave nothing back.
    expect(result.skips).toContain("candidate_recon_unavailable");
    // Ledger counts search queries ONLY. The recon fetch delivered no text, so it
    // books no credit and, critically, takes no query away from the run.
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued);
    expect(result.estimatedCostUsd).toBeCloseTo(searchQueriesIssued * 0.008 + result.llmCostUsd, 10);
    expect(result.status).not.toBe("failed");
  });

  it("books no recon credit when the extract call itself fails", async () => {
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon-throws/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockRejectedValue(new Error("tavily extract failed: 429"));
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // A throw is NOT an unbilled outcome. A timeout, 5xx, or unparseable body can
    // follow work Tavily already charged for, so the credit is booked worst-case —
    // understating it would let a later run overrun the monthly cap.
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued + 1);
    expect(result.estimatedCostUsd).toBeCloseTo((searchQueriesIssued + 1) * 0.008 + result.llmCostUsd, 10);
    // Distinct from the refused fetch: charged, and labelled as charged.
    expect(result.skips).toContain("candidate_recon_failed");
    expect(result.skips).not.toContain("candidate_recon_unavailable");
    // toErrorMessage surfaces a thrown Error's own message; the label is only the
    // fallback for a non-Error throw.
    expect(result.errors.some((message) => message.includes("tavily extract failed: 429"))).toBe(true);
    expect(result.status).toBe("partial");
  });

  it("still caps unfetchable recon attempts so an unreachable domain cannot retry unbounded", async () => {
    // Not booking a credit must not turn the per-run cap into a free-for-all: a
    // domain that always refuses is attempted MAX_RECON_FETCHES_PER_RUN times and
    // no more, however many borderline candidates it produces.
    mocks.tavilySearch.mockImplementationOnce(async () =>
      Array.from({ length: 4 }, (_, index) => ({
        title: "Crimson Desert patch 1.13 player discussion",
        url: `https://reddit.com/r/CrimsonDesert/comments/recon-refused-${index}/current_patch/`,
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      })),
    );
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(null);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(2);
    expect(result.skips.filter((skip) => skip === "candidate_recon")).toHaveLength(2);
    expect(result.skips.filter((skip) => skip === "candidate_recon_unavailable")).toHaveLength(2);
    const searchQueriesIssued = mocks.tavilySearch.mock.calls.length;
    expect(result.searchQueriesUsed).toBe(searchQueriesIssued);
  });

  it("hides existing public stale source links during a later scan even when no new mentions are kept", async () => {
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
          title: "Crimson Desert massive frame drops and stuttering after 1.04",
          summary: "Players discuss Crimson Desert frame drops after patch 1.04.",
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

  it("hides existing public bypass discussions during a later scan", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-crash",
          slug: "crash-startup",
          title: "Crash/startup issue",
          category: "crash_startup",
          description: "Public source was not actually a player bug report.",
          fix_status: "reported",
          confidence: "medium",
          is_public: true,
          auto_public: true,
          public_signal_count: 1,
        },
      ],
      source_signals: [
        {
          id: "signal-crackwatch",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://www.reddit.com/r/CrackWatch/comments/example",
          canonical_url: "https://www.reddit.com/r/CrackWatch/comments/example",
          title: "Crimson Desert Patch 1.13.01 HYPERVISOR by DenuvOwO",
          summary: "Discussion about repacks and bypass files.",
          source_domain: "reddit.com",
          source_published_at: null,
          semantic_fingerprint: "crackwatch-source",
          cluster_id: "cluster-crash",
          category: "crash_startup",
          confidence: "high",
          observed_at: "2026-07-09T08:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-09T12:00:00.000Z") });

    expect(result.staleSignalsHidden).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      public_status: "hidden",
      promotion_reason: "source_not_issue_report",
    });
    expect(tables.issue_clusters[0]).toMatchObject({
      public_signal_count: 0,
      auto_public: false,
      is_public: false,
    });
  });

  it("hides legacy public rows that never mention Crimson Desert", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-off-topic",
          slug: "off-topic",
          title: "Off-topic legacy row",
          category: "other",
          description: "A trusted-domain row that is unrelated to the game.",
          fix_status: "reported",
          confidence: "low",
          is_public: true,
          auto_public: true,
          public_signal_count: 1,
        },
      ],
      source_signals: [
        {
          id: "signal-protonmail",
          cluster_id: "cluster-off-topic",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://www.reddit.com/r/ProtonMail/comments/example/mcp",
          canonical_url: "https://www.reddit.com/r/ProtonMail/comments/example/mcp",
          source_domain: "reddit.com",
          title: "Any plans for MCP?",
          summary: "Proton rolled out an AI product called Lumo.",
          source_published_at: null,
          category: "other",
          confidence: "low",
          observed_at: "2026-07-22T08:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-22T12:00:00.000Z") });

    expect(result.staleSignalsHidden).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({ public_status: "hidden", promotion_reason: "off_topic" });
    expect(tables.issue_clusters[0]).toMatchObject({ public_signal_count: 0, auto_public: false, is_public: false });
  });

  it("quarantines stale public source links beyond the first audit page", async () => {
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
          title: "Crimson Desert massive frame drops and stuttering after 1.04",
          summary: "Players discuss Crimson Desert frame drops after patch 1.04.",
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

  it("refreshes observed_at when a rescued signal is re-observed as a reject", async () => {
    resetDb({
      source_signals: [
        {
          id: "signal-rescued",
          canonical_url: "https://example.com/rescued-rejection",
          seen_count: 1,
          observed_at: "2026-06-01T12:00:00.000Z",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch notes",
        url: "https://example.com/rescued-rejection",
        snippet: "Official update details.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsReobserved).toBe(1);
    expect(rejectedCandidateRows()).toEqual([]);
    expect(sourceSignalRows()[0]).toMatchObject({
      observed_at: "2026-07-05T12:00:00.000Z",
      last_seen_at: "2026-07-05T12:00:00.000Z",
    });
  });

  it("refreshes a rescued signal's cluster when re-observation makes its sources current", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-rescued",
          category: "performance",
          auto_public: false,
          is_public: false,
          visibility_revision: 0,
        },
      ],
      source_signals: [
        {
          id: "signal-rescued",
          cluster_id: "cluster-rescued",
          canonical_url: "https://example.com/rescued-rejection",
          source_domain: "dsogaming.com",
          title: "Crimson Desert patch 1.13 FPS regression",
          summary: "Frame rate drops after patch 1.13.00.",
          source_published_at: "2026-07-05T10:00:00.000Z",
          observed_at: "2026-06-01T12:00:00.000Z",
          seen_count: 1,
          public_status: "private",
        },
        {
          id: "signal-corroborating",
          cluster_id: "cluster-rescued",
          canonical_url: "https://example.net/current-stutter",
          source_domain: "example.net",
          title: "Crimson Desert patch 1.13 stutter",
          summary: "Stutter persists after patch 1.13.00.",
          source_published_at: "2026-07-05T10:00:00.000Z",
          observed_at: "2026-07-05T11:00:00.000Z",
          seen_count: 1,
          public_status: "private",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch notes",
        url: "https://example.com/rescued-rejection",
        snippet: "Official update details.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result).toMatchObject({ signalsReobserved: 1, clustersPromoted: 1 });
    expect(tables.issue_clusters[0]).toMatchObject({
      auto_public: true,
      is_public: true,
      public_signal_count: 2,
    });
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["public", "public"]);
  });

  it("records a re-observation event in the ledger when the table exists", async () => {
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
    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T13:00:00.000Z") });

    // First observation writes no event (first_seen_at already records it);
    // the re-observation writes exactly one.
    expect(tables.signal_observation_events).toHaveLength(1);
    expect(tables.signal_observation_events[0]).toMatchObject({
      signal_id: sourceSignalRows()[0].id,
      run_id: tables.automation_runs[1].id,
      observed_at: "2026-07-05T13:00:00.000Z",
    });
  });

  it("degrades the observation ledger to a no-op without failing the scan", async () => {
    observationEventInsertFailure = 'relation "signal_observation_events" does not exist';
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

    // The migration may not be applied in production: the ledger silently
    // stands down and the scan is untouched — still a success, still counted
    // as a re-observation, no error note.
    expect(secondResult.status).toBe("success");
    expect(secondResult.signalsReobserved).toBe(1);
    expect(secondResult.errors).toEqual([]);
    expect(tables.signal_observation_events).toHaveLength(0);
  });

  it("surfaces non-schema observation ledger failures instead of hiding them", async () => {
    observationEventInsertFailure = "permission denied for table signal_observation_events";
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

    expect(secondResult.status).toBe("failed");
    expect(secondResult.errors).toContain(
      "re-observation ledger write failed: permission denied for table signal_observation_events",
    );
  });

  it("spends one discovery slot on the wire's news-topic press query on eligible turns", async () => {
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 12:00Z with a single lane -> discovery turn % 3 === 0: the wire slot fires.
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    const calls = mocks.tavilySearch.mock.calls as [string, { topic?: string }?][];
    const newsCalls = calls.filter(([, options]) => options?.topic === "news");
    expect(newsCalls).toHaveLength(1);
    // The wire query names the game and never the patch version. Measured: the
    // versioned form returned dated articles about other games entirely, because the
    // news index matched the generic words around a version string no headline
    // carries. The patch gates downstream still decide what gets stored.
    expect(newsCalls[0][0]).toContain("Crimson Desert");
    expect(newsCalls[0][0]).not.toContain("1.13.00");
    // The wire REPLACES a general slot: total credit spend is unchanged.
    expect(result.searchQueriesUsed).toBe(calls.length);
  });

  it("keeps the wire's dated observations when the general queries fill the shelf first", async () => {
    // The defect this pins: collectInputs appends the wire results AFTER the
    // general queries, so a productive general turn filled every observation
    // slot with undated rows the Brief can never render — and the only dated
    // results in the run, the ones the wire credit exists to buy, were
    // discarded at the cap.
    mocks.tavilySearch.mockImplementation(async (_query: string, options?: { topic?: string }) => {
      if (options?.topic === "news") {
        // RFC 1123 is what Tavily's news index really emits (probed live
        // 2026-07-27) — the mapper passes published_date through untouched,
        // so an ISO fixture here would test a wire that does not exist.
        return [
          {
            title: "Crimson Desert Patch 1.13.00 Released & Detailed",
            url: "https://www.polygon.com/crimson-desert-1-13-notes",
            snippet: "Pearl Abyss detailed the update for all platforms.",
            sourceDomain: "polygon.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 09:00:00 GMT",
          },
          {
            title: "Crimson Desert Patch 1.13.00 Released For All Platforms",
            url: "https://www.pushsquare.com/news/crimson-desert-1-13-detailed",
            snippet: "The Crimson Desert update is out now.",
            sourceDomain: "pushsquare.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 10:00:00 GMT",
          },
          // The wire also re-returns a URL a general query already surfaced.
          // First-wins dedup drops this signal — but its date must coalesce
          // onto the undated shelf twin instead of vanishing with it.
          {
            title: "Crimson Desert Patch 1.13.00 Released & Detailed",
            url: "https://www.dsogaming.com/articles/cd-1-13-mirror-0",
            snippet: "Pearl Abyss detailed the update for all platforms.",
            sourceDomain: "dsogaming.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 08:00:00 GMT",
          },
          // And a dated duplicate of a mirror the dated wire results have
          // ALREADY DISPLACED by the time it arrives: no shelf row remains
          // to upgrade, so the page re-enters as its dated incarnation and
          // takes another undated row's slot.
          {
            title: "Crimson Desert Patch 1.13.00 Released & Detailed",
            url: "https://www.dsogaming.com/articles/cd-1-13-mirror-4",
            snippet: "Pearl Abyss detailed the update for all platforms.",
            sourceDomain: "dsogaming.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 07:00:00 GMT",
          },
        ];
      }
      // Every general query returns the same five undated patch-notes mirrors;
      // prepareSignals' first-wins URL dedup collapses the repeats, so exactly
      // five undated candidates reach the observation shelf — a full cap.
      return Array.from({ length: 5 }, (_, index) => ({
        title: "Crimson Desert Patch 1.13.00 Released & Detailed",
        url: `https://www.dsogaming.com/articles/cd-1-13-mirror-${index}`,
        snippet: "Pearl Abyss detailed the update for all platforms.",
        sourceDomain: "dsogaming.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      }));
    });
    const persistedObservations: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "persist_patch_observations") {
        const rows = (args.p_observations ?? []) as Record<string, unknown>[];
        persistedObservations.push(...rows);
        return { data: rows.length, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const { runAutomationMonitor } = await importRunner();

    // 12:00Z -> the wire slot fires, so the run holds both lanes.
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    const urls = persistedObservations.map((row) => row.url);
    expect(urls).toContain("https://www.polygon.com/crimson-desert-1-13-notes");
    expect(urls).toContain("https://www.pushsquare.com/news/crimson-desert-1-13-detailed");
    // The cap holds at five: the two dated rows displaced the two newest
    // undated mirrors, and the earliest mirrors keep first-wins seniority.
    expect(persistedObservations).toHaveLength(5);
    // Four dated rows: the two wire URLs, mirror-0 upgraded in place by its
    // deduped wire twin's date, and displaced mirror-4 re-entering as its
    // dated incarnation in another undated row's slot.
    expect(persistedObservations.filter((row) => row.source_published_at).length).toBe(4);
    const upgradedMirror = persistedObservations.find(
      (row) => row.url === "https://www.dsogaming.com/articles/cd-1-13-mirror-0",
    );
    expect(upgradedMirror?.source_published_at).toBe("Sun, 05 Jul 2026 08:00:00 GMT");
    const reenteredMirror = persistedObservations.find(
      (row) => row.url === "https://www.dsogaming.com/articles/cd-1-13-mirror-4",
    );
    expect(reenteredMirror?.source_published_at).toBe("Sun, 05 Jul 2026 07:00:00 GMT");
    expect(result.observationsKept).toBe(5);
    // Not a silent success: any unexpected rpc in this scenario would land in
    // an error-collecting catch and degrade the run to partial.
    expect(result.status).toBe("success");
  });

  it("never attaches an observation to a URL already kept as a signal", async () => {
    // The side door this pins shut: a general query keeps a page as a source
    // signal, then the wire re-returns the same URL with a different excerpt —
    // one that pre-screens as observation material — plus the publication date
    // the general copy lacked. The displaced-page re-entry path must not turn
    // that duplicate into an observation: one candidate yields a signal or an
    // observation, never the same page arguing both sides.
    const complaintUrl = "https://reddit.com/r/CrimsonDesert/comments/fps/towns";
    mocks.tavilySearch.mockImplementation(async (_query: string, options?: { topic?: string }) => {
      if (options?.topic === "news") {
        return [
          {
            title: "Crimson Desert Patch 1.13.00 Released & Detailed",
            url: complaintUrl,
            snippet: "Pearl Abyss detailed the update for all platforms.",
            sourceDomain: "reddit.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 09:00:00 GMT",
          },
        ];
      }
      return [
        {
          title: "Crimson Desert patch 1.13 FPS drops in towns",
          url: complaintUrl,
          snippet: "Players report stutter and FPS drops after patch 1.13.00.",
          sourceDomain: "reddit.com",
          observedAt: "2026-07-05T12:00:00.000Z",
          sourcePublishedAt: "2026-07-05T11:00:00.000Z",
        },
      ];
    });
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    const persistedObservations: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "persist_patch_observations") {
        const rows = (args.p_observations ?? []) as Record<string, unknown>[];
        persistedObservations.push(...rows);
        return { data: rows.length, error: null };
      }
      return defaultRpc(name, args);
    });
    const { runAutomationMonitor } = await importRunner();

    // 12:00Z -> the wire slot fires, so both copies of the page arrive.
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    // The complaint copy was kept as a signal...
    expect(sourceSignalRows().map((row) => row.canonical_url)).toContain(complaintUrl);
    // ...so the wire's dated marketing copy must not also mint an observation.
    expect(persistedObservations.map((row) => row.url)).not.toContain(complaintUrl);
    expect(result.status).toBe("success");
  });

  it("persists a direct provider date and never substitutes scanner time for it", async () => {
    mocks.tavilySearch.mockImplementation(async (_query: string, options?: { topic?: string }) => {
      if (options?.topic === "news") {
        return [
          {
            // Dated by the provider: this one must persist verbatim.
            title: "Crimson Desert Patch 1.13.00 Released & Detailed",
            url: "https://www.polygon.com/crimson-desert-1-13-notes",
            snippet: "Pearl Abyss detailed the update for all platforms.",
            sourceDomain: "polygon.com",
            observedAt: "2026-07-05T12:00:00.000Z",
            sourcePublishedAt: "Sun, 05 Jul 2026 09:00:00 GMT",
          },
        ];
      }
      return [
        {
          // Undated, and its snippet is full of dates that are NOT publication
          // dates. Neither those nor the scan's own clock may fill the column.
          title: "Crimson Desert Patch 1.13.00 Released & Detailed",
          url: "https://www.dsogaming.com/articles/cd-1-13-undated",
          snippet: "Pearl Abyss detailed the update for all platforms. Apr 4 @ 1:45am. See the July 14, 2026 recap.",
          sourceDomain: "dsogaming.com",
          observedAt: "2026-07-05T12:00:00.000Z",
        },
      ];
    });
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    const persistedObservations: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "persist_patch_observations") {
        const rows = (args.p_observations ?? []) as Record<string, unknown>[];
        persistedObservations.push(...rows);
        return { data: rows.length, error: null };
      }
      return defaultRpc(name, args);
    });
    const { runAutomationMonitor } = await importRunner();

    // 12:00Z -> the wire slot fires, so both the dated and undated copies arrive.
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    const dated = persistedObservations.find(
      (row) => row.url === "https://www.polygon.com/crimson-desert-1-13-notes",
    );
    expect(dated?.source_published_at).toBe("Sun, 05 Jul 2026 09:00:00 GMT");
    const undated = persistedObservations.find(
      (row) => row.url === "https://www.dsogaming.com/articles/cd-1-13-undated",
    );
    expect(undated).toBeDefined();
    expect(undated?.source_published_at).toBeNull();
    // Belt and braces: no persisted date may equal a scanner timestamp.
    const scannerTimes = new Set(["2026-07-05T12:00:00.000Z", ...persistedObservations.map((row) => String(row.observed_at))]);
    expect(persistedObservations.some((row) => scannerTimes.has(String(row.source_published_at)))).toBe(false);
    expect(result.status).toBe("success");
  });

  it("rejects invalid provider dates before Community Asks can use the undated fallback", async () => {
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Day 40 of asking for armor dye in Crimson Desert",
        url: "https://www.reddit.com/r/CrimsonDesert/comments/bad_date/armor_dye/",
        snippet: "The community keeps asking Pearl Abyss to add armor dye options.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T13:00:00.000Z",
        sourcePublishedAt: "yesterday afternoon",
      },
      {
        title: "Please add mount transmog to Crimson Desert",
        url: "https://www.reddit.com/r/CrimsonDesert/comments/future_date/mount_transmog/",
        snippet: "A feature request asking Pearl Abyss for mount transmog.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T13:00:00.000Z",
        sourcePublishedAt: "2026-07-08T14:00:00.000Z",
      },
    ]);
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    const persistedObservations: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "persist_patch_observations") {
        const rows = (args.p_observations ?? []) as Record<string, unknown>[];
        persistedObservations.push(...rows);
        return { data: rows.length, error: null };
      }
      return defaultRpc(name, args);
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T13:00:00.000Z") });

    expect(persistedObservations).toEqual([]);
    expect(rejectedCandidateRows()).toHaveLength(2);
    expect(rejectedCandidateRows().map((row) => row.reason)).toEqual([
      "invalid_source_date",
      "invalid_source_date",
    ]);
    expect(result.skips.filter((skip) => skip === "invalid_source_date")).toHaveLength(2);
    expect(result.prefilterRejected).toBe(2);
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("stops before observation persistence when stored-date ownership cannot be read", async () => {
    selectFailure = {
      table: "patch_observations",
      code: "42501",
      message: "permission denied for table patch_observations",
    };
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain(
      "stored observation dates read failed: permission denied for table patch_observations",
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith("persist_patch_observations", expect.anything());
  });

  it("keeps the rolling-deploy fallback narrow to a missing observations relation", async () => {
    selectFailure = {
      table: "patch_observations",
      code: "PGRST205",
      message: "Could not find the table patch_observations in the schema cache",
    };
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
  });

  it("surfaces a thrown stored-date timeout instead of treating it as no rows", async () => {
    beforeSelect = (table) => {
      if (table === "patch_observations") throw new Error("database request timed out");
    };
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("failed");
    expect(result.errors).toContain("stored observation dates read failed: database request timed out");
    expect(mocks.rpc).not.toHaveBeenCalledWith("persist_patch_observations", expect.anything());
  });

  it("keeps every search slot on general (dated-less) search on non-wire turns", async () => {
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    // 13:00Z -> discovery turn % 3 === 1: no wire slot, complaint hunt untouched.
    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T13:00:00.000Z") });

    const calls = mocks.tavilySearch.mock.calls as [string, { topic?: string }?][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, options]) => options?.topic === undefined)).toBe(true);
  });

  it("changes the next scheduled intent after a zero-kept scan", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    // Site-scoped, but not pinned to one forum: the corroborate lane now rotates
    // through community AND press sources so a reddit-heavy cluster can reach the
    // second independent domain promotion requires. Which source a given turn draws
    // is covered directly in the query-planning tests.
    // Pinned exactly. The lane rotation depends on run.ts passing BOTH laneCount and
    // searchRotationOffset through to the query builder; a loose `/^site:/` still
    // passed when either was dropped, which is how the rotation could silently
    // collapse back onto one forum.
    expect(mocks.tavilySearch.mock.calls[0][0]).toBe(
      "site:pushsquare.com OR site:purexbox.com OR site:wccftech.com Crimson Desert patch 1.13.00 crash stutter freeze FPS",
    );
    expect(tables.automation_runs[1]).toMatchObject({
      intent: "corroborate_cluster",
    });
  });

  it("uses the patch burst budget and records the active window in the run ledger", async () => {
    const burstPatch = {
      ...officialPatchFixture,
      observedAt: "2026-07-05T11:00:00.000Z",
    };
    mocks.getCurrentPatchMetadata.mockResolvedValue(burstPatch);
    mocks.syncOfficialPatchNote.mockResolvedValue({ status: "synced", changed: false, patch: burstPatch });
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(mocks.tavilySearch).toHaveBeenCalledTimes(2);
    expect(result.skips).toContain("patch_burst_active");
    expect(tables.automation_runs[0].skips).toContain("patch_burst_active");
  });

  it("reserves a Tavily credit for candidate recon in a normal scheduled run", async () => {
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon-scheduled/current_patch/",
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

    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T12:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(mocks.tavilySearch).toHaveBeenCalledTimes(1);
    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(1);
    expect(result.candidatesRescued).toBe(1);
    expect(result.searchQueriesUsed).toBe(2);
    expect(tables.automation_runs[0].search_queries_used).toBe(2);
    expect(result.estimatedCostUsd).toBeCloseTo(2 * 0.008 + result.llmCostUsd, 10);
  });

  it("keeps burst search and recon candidates inside the three-credit Tavily cap", async () => {
    const burstPatch = {
      ...officialPatchFixture,
      observedAt: "2026-07-05T13:00:00.000Z",
    };
    mocks.getCurrentPatchMetadata.mockResolvedValue(burstPatch);
    mocks.syncOfficialPatchNote.mockResolvedValue({ status: "synced", changed: false, patch: burstPatch });
    mocks.tavilySearch.mockImplementationOnce(async () => [
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon-burst-1/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T14:00:00.000Z",
        sourcePublishedAt: "2026-07-05T13:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 player discussion",
        url: "https://reddit.com/r/CrimsonDesert/comments/recon-burst-2/current_patch/",
        snippet: "Body retained for moderator review.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T14:00:00.000Z",
        sourcePublishedAt: "2026-07-05T13:00:00.000Z",
      },
    ]);
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.tavilyExtract.mockResolvedValue(
      "Players report constant stutter and fps drops on patch 1.13.00 across the whole map.",
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({
      mode: "scheduled",
      now: new Date("2026-07-05T14:00:00.000Z"),
      scannerPolicy: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 2,
        modelPreset: "gpt_5_6_luna",
      },
    });

    // The community-pulse pack has two search queries, leaving one of the
    // burst's three Tavily credits for exactly one recon fetch.
    expect(mocks.tavilySearch).toHaveBeenCalledTimes(2);
    expect(mocks.tavilyExtract).toHaveBeenCalledTimes(1);
    expect(result.searchQueriesUsed).toBe(3);
    expect(result.estimatedCostUsd).toBeCloseTo(3 * 0.008 + result.llmCostUsd, 10);
    expect(tables.automation_runs[0].search_queries_used).toBe(3);
  });

  it("targets corroboration when private weak source signals exist", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    // Site-scoped, but not pinned to one forum: the corroborate lane now rotates
    // through community AND press sources so a reddit-heavy cluster can reach the
    // second independent domain promotion requires. Which source a given turn draws
    // is covered directly in the query-planning tests.
    // Pinned exactly, including the cluster title the lane is corroborating. See the
    // note on the sibling assertion: a loose site: match hid a dropped laneCount.
    expect(mocks.tavilySearch.mock.calls[0][0]).toBe(
      "site:pushsquare.com OR site:purexbox.com OR site:wccftech.com Crimson Desert patch 1.13.00 " +
        "Shader compilation stutter crash stutter freeze FPS",
    );
    expect(tables.automation_runs[0]).toMatchObject({ intent: "corroborate_cluster" });
  });

  it("hunts zero-evidence public seed clusters by name", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(result.targetClusterTitles).toContain("Boss rematch crash persistent");
    expect(result.intent).toBe("corroborate_cluster");
    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("Boss rematch crash persistent");
    expect(tables.automation_runs[0]).toMatchObject({ intent: "corroborate_cluster" });
  });

  it("targets rescue when live rejected candidates exist", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).toContain("site:reddit.com OR site:steamcommunity.com");
    expect(tables.automation_runs[0]).toMatchObject({ intent: "rescue_candidate" });
  });

  it("ignores stale, rescued, and non-rescuable rejected candidates when planning rescue", async () => {
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
        modelPreset: "gpt_5_6_luna",
      },
    });

    expect(mocks.tavilySearch.mock.calls[0][0]).not.toContain("site:reddit.com OR site:steamcommunity.com");
    expect(tables.automation_runs[0]).not.toMatchObject({ intent: "rescue_candidate" });
  });

  it("preserves candidate freshness when rescuing a rejected source", async () => {
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
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

  it("uses the saved model and effective provider cap when rescuing a rejected source", async () => {
    resetDb({
      automation_settings: [{
        key: "scanner",
        value: {
          paused: false,
          minIntervalMinutes: 60,
          scheduledSearchCreditsPerRun: 1,
          monthlyTavilyCreditCap: 900,
          monthlyLlmUsdCap: 0.5,
          modelPreset: "gpt_5_6_luna_flex",
        },
        updated_at: "2026-07-05T10:00:00.000Z",
      }],
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
          visibility_revision: 0,
        },
      ],
    });
    configureProviders();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: { limit: 1, limit_remaining: 0.8, limit_reset: "monthly", usage_monthly: 0.2 },
    })));
    mocks.extractSignalWithOpenRouter.mockResolvedValueOnce({
      issueTitle: "Heavy traversal stutter",
      category: "performance",
      platform: "pc_steam",
      confidence: "high",
      summary: "Traversal causes repeated frame-time spikes on Steam.",
      clusterAssignment: "sure",
      clusterReason: "The report clearly matches the seeded performance cluster.",
      clusterSlug: "performance_regression",
      extractionProvider: "openrouter",
      extractionModel: "openai/gpt-5.6-luna",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
    });
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
      {
        title: "Traversal hitching",
        url: "https://reddit.com/r/CrimsonDesert/comments/traversal/hitching/",
        sourceDomain: "reddit.com",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
        snippet: "Steam players report frame-time spikes while crossing the open world.",
      },
    );

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 0.3,
        modelPreset: "gpt_5_6_luna_flex",
        clusterOptions: [
          {
            slug: "performance_regression",
            title: "Performance regression",
            category: "performance",
            description: "Seeded watchlist cluster.",
          },
        ],
      }),
    );
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      cluster_id: "cluster-seeded-perf",
      extraction_provider: "openrouter",
      extraction_model: "openai/gpt-5.6-luna",
    });
    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      status: "success",
      mode: "manual",
      intent: "rescue_candidate",
      llm_calls_used: 1,
      funnel: expect.objectContaining({ llmCalls: 1 }),
      progress: expect.objectContaining({ llmSucceeded: 1, llmCostUsd: 0.0002 }),
      candidates_rescued: 1,
      estimated_cost_usd: 0.0002,
    });
  });

  it("records an attempted fallback separately from a validated LLM success", async () => {
    mocks.extractSignalWithOpenRouter.mockResolvedValueOnce({
      issueTitle: "Traversal hitching",
      category: "performance",
      platform: "pc_steam",
      confidence: "medium",
      summary: "Steam players report traversal hitching.",
      clusterAssignment: "unsure",
      clusterReason: "Deterministic fallback cannot assign a cluster.",
      clusterSlug: null,
      extractionProvider: "deterministic",
      extractionModel: null,
      llmCallsUsed: 1,
      llmCostUsd: 0,
      fallbackReason: "openrouter_invalid_json",
    });
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
      {
        title: "Traversal hitching",
        url: "https://reddit.com/r/CrimsonDesert/comments/traversal/fallback/",
        sourceDomain: "reddit.com",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
        snippet: "Steam players report traversal hitching after the current patch.",
      },
    );

    expect(tables.automation_runs).toHaveLength(1);
    expect(tables.automation_runs[0]).toMatchObject({
      llm_calls_used: 1,
      funnel: expect.objectContaining({ llmCalls: 1 }),
      progress: expect.objectContaining({ llmSucceeded: 0, llmCostUsd: 0 }),
    });
    expect(tables.automation_runs[0].funnel).not.toHaveProperty("llmSucceeded");
    expect(tables.automation_runs[0].funnel).not.toHaveProperty("llmCostUsd");
    expect(tables.automation_runs[0].funnel).not.toHaveProperty("modelPreset");
    expect(sourceSignalRows()[0]).toMatchObject({ extraction_provider: "deterministic" });
  });

  it("pages past the hosted row cap before semantic rescue routing", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-a-controls",
          slug: "uncomfortable_controls",
          title: "Uncomfortable controls",
          category: "controls_gameplay",
          description: "Controller layout discomfort.",
          last_signal_at: "2026-07-04T12:00:00.000Z",
          created_at: "2026-07-01T12:00:00.000Z",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          visibility_revision: 0,
        },
        {
          id: "cluster-z-performance",
          slug: "performance_regression",
          title: "Performance regression",
          category: "performance",
          description: "Post-patch frame-time spikes and stuttering.",
          last_signal_at: "2026-07-05T12:00:00.000Z",
          created_at: "2026-07-02T12:00:00.000Z",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          visibility_revision: 0,
        },
      ],
    });
    hostedRowCap = { table: "issue_clusters", rows: 1 };
    configureProviders();
    mocks.extractSignalWithOpenRouter.mockResolvedValueOnce({
      issueTitle: "Heavy traversal stutter",
      category: "performance",
      platform: "pc_steam",
      confidence: "high",
      summary: "Traversal causes repeated frame-time spikes on Steam.",
      clusterAssignment: "sure",
      clusterReason: "The report matches the established performance cluster.",
      clusterSlug: "performance_regression",
      extractionProvider: "openrouter",
      extractionModel: "openai/gpt-5.6-luna",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
    });
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
      {
        title: "Latest patch introduced stuttering",
        url: "https://steamcommunity.com/app/example/discussions/stuttering/",
        sourceDomain: "steamcommunity.com",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
        snippet: "Nvidia players report frame-time spikes after the current patch.",
      },
    );

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        clusterOptions: expect.arrayContaining([
          expect.objectContaining({ slug: "uncomfortable_controls" }),
          expect.objectContaining({ slug: "performance_regression" }),
        ]),
      }),
    );
    expect(sourceSignalRows()[0]).toMatchObject({ cluster_id: "cluster-z-performance" });
    expect(tables.issue_clusters).toHaveLength(2);
  });

  it("keeps temporary force-hidden auto-clusters routable while excluding merged duplicates", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-active-xbox",
          slug: "auto-3504f3a93c0b",
          title: "Xbox graphics glitches",
          category: "graphics_visual",
          description: "Active aggregate for Xbox graphics reports.",
          last_signal_at: "2026-07-30T12:00:00.000Z",
          created_at: "2026-07-20T12:00:00.000Z",
          admin_visibility_override: null,
          lifecycle_reason: null,
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          visibility_revision: 0,
        },
        {
          id: "cluster-retired-xbox",
          slug: "auto-b7e557a13e9d",
          title: "Xbox graphics glitch duplicate",
          category: "graphics_visual",
          description: "Merged duplicate that must never receive new signals.",
          last_signal_at: "2026-07-31T12:00:00.000Z",
          created_at: "2026-07-21T12:00:00.000Z",
          admin_visibility_override: "force_hidden",
          lifecycle_reason: "Merged into auto-3504f3a93c0b (duplicate Xbox graphics-glitch lead)",
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          visibility_revision: 1,
        },
        {
          id: "cluster-temporary-hidden-xbox",
          slug: "auto-temporary-hidden-xbox",
          title: "Xbox texture corruption",
          category: "graphics_visual",
          description: "Temporarily hidden while the maintainer checks presentation.",
          last_signal_at: "2026-07-29T12:00:00.000Z",
          created_at: "2026-07-22T12:00:00.000Z",
          admin_visibility_override: "force_hidden",
          lifecycle_reason: null,
          fix_status: "reported",
          confidence: "low",
          is_public: false,
          auto_public: false,
          visibility_revision: 1,
        },
      ],
    });
    honorIssueClusterProjection = true;
    configureProviders();
    mocks.extractSignalWithOpenRouter.mockResolvedValueOnce({
      issueTitle: "Xbox texture corruption",
      category: "graphics_visual",
      platform: "xbox_series",
      confidence: "high",
      summary: "Xbox players report corrupted textures after the current patch.",
      clusterAssignment: "sure",
      clusterReason: "The report matches the temporarily hidden active cluster.",
      clusterSlug: "auto-temporary-hidden-xbox",
      extractionProvider: "openrouter",
      extractionModel: "openai/gpt-5.6-luna",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
    });
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
      {
        title: "Xbox texture corruption after patch",
        url: "https://reddit.com/r/CrimsonDesert/comments/xbox/texture-corruption/",
        sourceDomain: "reddit.com",
        sourcePublishedAt: "2026-07-31T11:00:00.000Z",
        snippet: "Xbox players report corrupted textures after the current patch.",
      },
    );

    const [, extractionOptions] = mocks.extractSignalWithOpenRouter.mock.calls[0] as unknown as [
      unknown,
      { clusterOptions: { slug: string }[] },
    ];
    expect(extractionOptions.clusterOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "auto-temporary-hidden-xbox" })]),
    );
    expect(extractionOptions.clusterOptions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "auto-b7e557a13e9d" })]),
    );
    expect(sourceSignalRows()[0]?.cluster_id).toBe("cluster-temporary-hidden-xbox");
    expect(tables.issue_clusters).toHaveLength(3);
  });

  it("rescues deterministically without spending when the monthly LLM budget is exhausted", async () => {
    resetDb({
      automation_runs: [
        {
          id: "run-monthly-cap",
          started_at: new Date().toISOString(),
          estimated_cost_usd: 2,
          search_queries_used: 0,
          skips: [],
        },
      ],
    });
    configureProviders();
    const { rescueCandidateSignal } = await importRunner();

    await rescueCandidateSignal(
      { from: mocks.from, rpc: mocks.rpc } as never,
      {
        title: "Traversal hitching",
        url: "https://reddit.com/r/CrimsonDesert/comments/traversal/capped/",
        sourceDomain: "reddit.com",
        snippet: "Steam players report frame-time spikes while crossing the open world.",
      },
    );

    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ llmCallsRemaining: 0, llmBudgetRemainingUsd: 0 }),
    );
    expect(sourceSignalRows()).toHaveLength(1);
    expect(sourceSignalRows()[0]).toMatchObject({ extraction_provider: "deterministic" });
    expect(tables.automation_runs).toHaveLength(2);
    expect(tables.automation_runs[1]).toMatchObject({
      status: "success",
      mode: "manual",
      intent: "rescue_candidate",
      llm_calls_used: 0,
      candidates_rescued: 1,
      estimated_cost_usd: 0,
    });
    expect(tables.automation_runs[1].skips).toContain("llm_budget_capped");
  });

  it("routes a kept signal into a seeded watchlist cluster instead of creating a new one", async () => {
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "FPS drops since 1.13",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-fps-route/fps",
        snippet: "Steam users are seeing stutter.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "FPS drops since 1.13",
        url: "https://reddit.com/r/CrimsonDesert/comments/reddit-fps-seed-visible/fps",
        snippet: "Steam users are seeing stutter.",
        sourceDomain: "reddit.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
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
          title: "Crimson Desert crashes on startup after 1.04",
          summary: "Players report Crimson Desert startup crashes on patch 1.04.",
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
          semantic_fingerprint: semanticFingerprint("FPS regression since 1.13", "performance"),
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
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://fresh.example.com/fps",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "fresh.example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
        sourcePublishedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);
    delete process.env.OPENROUTER_API_KEY;
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.signalsInserted).toBe(1);
    expect(result.clustersPromoted).toBe(0);
    expect(sourceSignalRows()).toHaveLength(2);
    expect(sourceSignalRows().map((row) => row.public_status)).toEqual(["hidden", "private"]);
    expect(sourceSignalRows()[0]).toMatchObject({ promotion_reason: "off_topic" });
    expect(tables.issue_clusters[0]).toMatchObject({
      signal_count: 2,
      public_signal_count: 0,
      auto_public: false,
      is_public: false,
    });
  });

  it("records promotion update failures without incrementing promoted clusters", async () => {
    visibilityRefreshFailure = "source signal status update failed";
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("partial");
    expect(result.errors[0]).toContain("source signal status update failed");
    expect(result.clustersPromoted).toBe(0);
    expect(tables.automation_runs[0]).toMatchObject({
      status: "partial",
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

  it("auto-starts lifecycle watching when an LLM-sure claimed fix maps to a cluster", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          fix_claimed_at: null,
          admin_override: false,
          lifecycle_reason: null,
          is_public: true,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
    ]);
    mocks.mapClaimToClusterWithOpenRouter.mockResolvedValue({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
      reason: "PA claim matches FPS regression.",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
      extractionModel: "openrouter/free",
    });
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "fix_claimed",
      fix_claimed_at: "2026-07-05T12:00:00.000Z",
      // normal states carry no automation prose — the readout composes it at read time
      lifecycle_reason: null,
    });
    const lifecycleUpdate = mutations.find(
      (mutation) => mutation.table === "issue_clusters" && (mutation.row as { fix_status?: unknown }).fix_status === "fix_claimed",
    );
    expect(lifecycleUpdate?.filters).toEqual(
      expect.arrayContaining([
        { type: "eq", column: "id", value: "cluster-fps" },
        { type: "eq", column: "admin_override", value: false },
        { type: "eq", column: "fix_status", value: "reported" },
        { type: "is", column: "fix_claimed_at", value: null },
      ]),
    );
  });

  it("does not regress a newer lifecycle status when a stale run snapshot writes late", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          fix_claimed_at: null,
          admin_override: false,
          lifecycle_reason: null,
          is_public: true,
        },
      ],
    });
    beforeUpdate = (table, patch) => {
      if (table !== "issue_clusters" || patch.fix_status !== "fix_claimed") return;
      Object.assign(tables.issue_clusters[0], {
        fix_status: "persists",
        lifecycle_reason: "Fresh public evidence appeared after the claimed fix.",
      });
    };
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
    ]);
    mocks.mapClaimToClusterWithOpenRouter.mockResolvedValue({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
      reason: "PA claim matches FPS regression.",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
      extractionModel: "openrouter/free",
    });
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "persists",
      fix_claimed_at: null,
      lifecycle_reason: "Fresh public evidence appeared after the claimed fix.",
    });
  });

  it("keeps keyword-only claimed-fix matches as admin proposals", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          fix_claimed_at: null,
          admin_override: false,
          lifecycle_reason: null,
          is_public: true,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
    ]);
    mocks.mapClaimToClusterWithOpenRouter.mockResolvedValue({
      matchKind: "keyword_proposal",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
      reason: "keyword match is only a proposal.",
      llmCallsUsed: 0,
      llmCostUsd: 0,
      extractionModel: null,
    });
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "reported",
      fix_claimed_at: null,
      lifecycle_reason: "Needs review: keyword match is only a proposal.",
    });
  });

  it("never ages a claimed fix by silence — quiet days stay fix_claimed", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "fix_claimed",
          fix_claimed_at: "2026-07-01T12:00:00.000Z",
          fix_claimed_patch_version: "1.13.00",
          admin_override: false,
          lifecycle_reason: null,
          is_public: true,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-30T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "fix_claimed",
      fix_claimed_at: "2026-07-01T12:00:00.000Z",
      lifecycle_reason: null,
    });
  });

  it("leaves persistence to the read-time composer — no persists writes from evidence", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "fix_claimed",
          fix_claimed_at: "2026-07-04T12:00:00.000Z",
          fix_claimed_patch_version: "1.13.00",
          admin_override: false,
          lifecycle_reason: null,
          is_public: true,
        },
      ],
      source_signals: [
        {
          id: "signal-public",
          cluster_id: "cluster-fps",
          title: "FPS still drops after patch 1.13.00",
          summary: "Players report FPS drops after the patch.",
          source_published_at: "2026-07-04T13:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "fix_claimed",
      fix_claimed_at: "2026-07-04T12:00:00.000Z",
    });
  });

  it("does not clobber admin-overridden lifecycle status", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-fps",
          slug: "performance_regression",
          title: "FPS regression",
          category: "performance",
          description: "Frame-rate drops after the patch.",
          fix_status: "reported",
          fix_claimed_at: null,
          admin_override: true,
          lifecycle_reason: "Locked by you. Manual status set to Open.",
          is_public: true,
        },
      ],
    });
    configureProviders();
    mocks.tavilySearch.mockResolvedValue([]);
    mocks.getClaimedFixesForCurrentPatch.mockResolvedValue([
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
    ]);
    mocks.mapClaimToClusterWithOpenRouter.mockResolvedValue({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
      reason: "PA claim matches FPS regression.",
      llmCallsUsed: 1,
      llmCostUsd: 0.0002,
      extractionModel: "openrouter/free",
    });
    const { runAutomationMonitor } = await importRunner();

    await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(tables.issue_clusters[0]).toMatchObject({
      fix_status: "reported",
      fix_claimed_at: null,
      admin_override: true,
    });
    expect(tables.issue_clusters[0].lifecycle_reason).toBe("Locked by you. System would show: Fix claimed — unverified.");
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
      modelPreset: "gpt_5_6_luna",
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
        monthlyLlmUsdCap: 2,
      }),
    });
    expect(mocks.insertSkippedScheduledRun).not.toHaveBeenCalled();
  });

  it("revalidates public surfaces after a successful scheduled scan", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
    });
    configureProviders();
    mocks.runAutomationMonitor.mockResolvedValue({ status: "partial" });
    const revalidatePublicSurfaces = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    vi.doMock("@/lib/revalidate", () => ({ revalidatePublicSurfaces }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const response = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(revalidatePublicSurfaces).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate public surfaces when the scheduled scan fails or is skipped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
    process.env.CRON_SECRET = "cron-secret";
    resetDb({
      automation_runs: [],
      issue_clusters: [{ id: "cluster-fps", title: "FPS", slug: "fps" }],
    });
    configureProviders();
    mocks.runAutomationMonitor.mockResolvedValue({ status: "failed" });
    const revalidatePublicSurfaces = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/automation/run", () => ({
      runAutomationMonitor: mocks.runAutomationMonitor,
      insertSkippedScheduledRun: mocks.insertSkippedScheduledRun,
    }));
    vi.doMock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));
    vi.doMock("@/lib/revalidate", () => ({ revalidatePublicSurfaces }));
    const { GET } = await import("@/app/api/cron/keepalive/route");

    const failedResponse = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(failedResponse.status).toBe(200);
    expect(revalidatePublicSurfaces).not.toHaveBeenCalled();

    // A paused scanner skips before running and must not invalidate either.
    mocks.getAutomationControlState.mockResolvedValue({ paused: true, updatedAt: "2026-07-05T12:00:00.000Z" });
    const skippedResponse = await GET(
      new Request("https://example.com/api/cron/keepalive", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(skippedResponse.status).toBe(200);
    expect(revalidatePublicSurfaces).not.toHaveBeenCalled();
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

describe("Steam Pulse intake", () => {
  it("keeps legacy scanning active when the Steam Pulse snapshot table is not migrated yet", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    selectFailure = {
      table: "steam_pulse_snapshots",
      message: "relation steam_pulse_snapshots does not exist",
    };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.skips).toContain("steam_pulse_schema_unavailable");
    expect(result.errors).not.toContain(expect.stringContaining("Steam Pulse"));
    expect(mocks.fetchSteamReviewBatch).not.toHaveBeenCalled();
  });

  it("keeps legacy scanning active when the Steam review receipt table is not migrated yet", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    selectFailure = {
      table: "steam_review_receipts",
      message: "Could not find relation steam_review_receipts in the schema cache",
    };
    configureProviders();
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [
        {
          recommendationHash: externalIdHash("steam_review", "pre-migration-review"),
          reviewText: "Crimson Desert stutters after patch 1.13 on Steam.",
          sourceCreatedAt: "2026-07-05T10:00:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 120,
        },
      ],
      totals: { totalReviews: 1, totalPositive: 0, totalNegative: 1 },
      cursor: null,
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.skips).toContain("steam_pulse_schema_unavailable");
    expect(result.errors).not.toContain(expect.stringContaining("Steam review receipt"));
  });

  it("marks unexpected Steam Pulse read failures partial and records the error", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    selectFailure = {
      table: "steam_pulse_snapshots",
      message: "permission denied for table steam_pulse_snapshots",
    };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("partial");
    expect(result.skips).not.toContain("steam_pulse_schema_unavailable");
    expect(result.errors).toContain(
      "Steam Pulse recency read failed: permission denied for table steam_pulse_snapshots",
    );
  });

  it("uses an edited Steam review's update time for freshness while retaining its creation time", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    const recommendationHash = externalIdHash("steam_review", "edited-after-current-patch");
    configureProviders();
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [
        {
          recommendationHash,
          reviewText: "Crimson Desert crashes every few minutes when opening the map.",
          sourceCreatedAt: "2026-06-30T10:00:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 240,
        },
      ],
      totals: { totalReviews: 1, totalPositive: 0, totalNegative: 1 },
      cursor: null,
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()[0]).toMatchObject({
      external_id_hash: recommendationHash,
      source_published_at: "2026-07-05T10:30:00.000Z",
    });
    expect(tables.steam_review_receipts[0]).toMatchObject({
      recommendation_hash: recommendationHash,
      source_created_at: "2026-06-30T10:00:00.000Z",
      source_updated_at: "2026-07-05T10:30:00.000Z",
    });
  });

  it("follows Steam's review cursor so changes beyond the first page are not skipped", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    const knownHash = externalIdHash("steam_review", "known-first-page-review");
    const laterHash = externalIdHash("steam_review", "new-second-page-review");
    resetDb({
      steam_review_receipts: [
        {
          recommendation_hash: knownHash,
          first_seen_at: "2026-07-05T08:00:00.000Z",
          last_seen_at: "2026-07-05T08:00:00.000Z",
          source_created_at: "2026-07-05T07:00:00.000Z",
          source_updated_at: "2026-07-05T08:00:00.000Z",
          voted_up: false,
          playtime_at_review_minutes: 120,
        },
      ],
    });
    configureProviders();
    mocks.fetchSteamReviewBatch.mockImplementation(async (options?: { cursor?: string }) =>
      options?.cursor === "second-page"
        ? {
          reviews: [
            {
              recommendationHash: laterHash,
              reviewText: "Crimson Desert crashes every time I open the map after patch 1.13.",
              sourceCreatedAt: "2026-07-05T09:00:00.000Z",
              sourceUpdatedAt: "2026-07-05T09:30:00.000Z",
              votedUp: false,
              playtimeAtReviewMinutes: 240,
            },
          ],
          totals: { totalReviews: 150, totalPositive: 100, totalNegative: 50 },
          cursor: null,
        }
        : {
          reviews: [
            {
              recommendationHash: knownHash,
              reviewText: "Crimson Desert had an older stutter report already processed.",
              sourceCreatedAt: "2026-07-05T07:00:00.000Z",
              sourceUpdatedAt: "2026-07-05T08:00:00.000Z",
              votedUp: false,
              playtimeAtReviewMinutes: 120,
            },
          ],
          totals: { totalReviews: 150, totalPositive: 100, totalNegative: 50 },
          cursor: "second-page",
        },
    );
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.fetchSteamReviewBatch).toHaveBeenCalledTimes(2);
    expect(mocks.fetchSteamReviewBatch).toHaveBeenNthCalledWith(2, {
      cursor: "second-page",
      fallbackTotals: { totalReviews: 150, totalPositive: 100, totalNegative: 50 },
    });
    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()).toEqual(
      expect.arrayContaining([expect.objectContaining({ external_id_hash: laterHash, public_status: "private" })]),
    );
  });

  it("caps a long Steam cursor walk and records that the page window was incomplete", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    configureProviders();
    mocks.fetchSteamReviewBatch.mockImplementation(async (options?: { cursor?: string }) => {
      const page = options?.cursor ? Number(options.cursor.replace("page-", "")) : 1;
      return {
        reviews: [],
        totals: { totalReviews: 2_000, totalPositive: 1_500, totalNegative: 500 },
        cursor: `page-${page + 1}`,
      };
    });
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(mocks.fetchSteamReviewBatch).toHaveBeenCalledTimes(10);
    expect(result.skips).toContain("steam_pulse_page_cap");
    expect(result.status).toBe("success");
  });

  it("keeps Steam review text private even when its cluster is public from a direct report", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-steam",
          slug: "steam-stutter",
          title: "Steam stutter",
          category: "performance",
          auto_public: false,
          is_public: false,
          visibility_revision: 0,
        },
      ],
      bug_reports: [
        {
          id: "report-steam",
          cluster_id: "cluster-steam",
          category: "performance",
          platform: "pc_steam",
          issue_title: "Steam stutter after patch 1.13.00",
          moderation_status: "approved",
        },
      ],
      source_signals: [
        {
          id: "signal-steam",
          cluster_id: "cluster-steam",
          source: "steam_review",
          source_type: "steam_review",
          source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          canonical_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          source_domain: "store.steampowered.com",
          title: "Crimson Desert player issue on Steam",
          summary: "Crimson Desert stutters after patch 1.13.00.",
          raw_text: "Private Steam review text.",
          source_published_at: "2026-07-05T10:00:00.000Z",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-steam", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({ is_public: true, direct_report_count: 1, public_signal_count: 0 });
    expect(sourceSignalRows()[0]).toMatchObject({ public_status: "private", promotion_reason: "source_context_only" });
  });

  it("keeps a stored official-domain signal private as provider context", async () => {
    // Rows stored BEFORE the pre-screen learned to route official domains to the
    // observation lane. The publisher's page must resolve to context-only — never
    // presented as a cluster's player evidence — even where it was already public.
    resetDb({
      issue_clusters: [
        {
          id: "cluster-official",
          slug: "official-stutter",
          title: "Official stutter",
          category: "performance",
          auto_public: false,
          is_public: false,
          visibility_revision: 0,
        },
      ],
      bug_reports: [
        {
          id: "report-official",
          cluster_id: "cluster-official",
          category: "performance",
          platform: "pc_steam",
          issue_title: "Stutter after patch 1.13.00",
          moderation_status: "approved",
        },
      ],
      source_signals: [
        {
          id: "signal-official",
          cluster_id: "cluster-official",
          source: "web_search",
          source_type: "web_search",
          source_url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
          canonical_url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
          source_domain: "crimsondesert.pearlabyss.com",
          title: "Crimson Desert known issues after patch 1.13.00",
          summary: "Crimson Desert stutters after patch 1.13.00.",
          raw_text: "Official known issues notice.",
          source_published_at: "2026-07-05T10:00:00.000Z",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-07-05T10:00:00.000Z",
          public_status: "public",
        },
      ],
    });
    configureProviders();
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-official", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({ is_public: true, direct_report_count: 1, public_signal_count: 0 });
    expect(sourceSignalRows()[0]).toMatchObject({ public_status: "private", promotion_reason: "source_context_only" });
  });

  it("does not let Steam-only context keep a formerly automatic-public cluster visible", async () => {
    resetDb({
      issue_clusters: [
        {
          id: "cluster-steam-only",
          slug: "steam-only-context",
          title: "Steam-only context",
          category: "performance",
          auto_public: true,
          is_public: true,
          public_signal_count: 1,
          visibility_revision: 0,
        },
      ],
      source_signals: [
        {
          id: "signal-steam-only",
          cluster_id: "cluster-steam-only",
          source: "steam_review",
          source_type: "steam_review",
          source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          canonical_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          source_domain: "store.steampowered.com",
          title: "Crimson Desert player issue on Steam",
          summary: "Crimson Desert stutters after patch 1.13.00.",
          raw_text: "Private Steam review text.",
          source_published_at: "2026-07-05T10:00:00.000Z",
          category: "performance",
          confidence: "medium",
          observed_at: "2026-07-05T10:00:00.000Z",
          public_status: "private",
        },
      ],
    });
    configureProviders();
    const { refreshClusterVisibility } = await importRunner();

    await refreshClusterVisibility("cluster-steam-only", new Date("2026-07-05T12:00:00.000Z"));

    expect(tables.issue_clusters[0]).toMatchObject({
      is_public: false,
      auto_public: false,
      public_signal_count: 0,
    });
    expect(sourceSignalRows()[0]).toMatchObject({
      public_status: "private",
      promotion_reason: "source_context_only",
    });
  });

  it("keeps identities out of storage, retains only issue leads, and writes aggregate context", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";

    const issueHash = externalIdHash("steam_review", "recommendation-issue");
    const praiseHash = externalIdHash("steam_review", "recommendation-praise");
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [
        {
          recommendationHash: issueHash,
          reviewText: "Since patch 1.13 the game stutters and crashes every ten minutes on Steam.",
          sourceCreatedAt: "2026-07-05T10:00:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 420,
        },
        {
          recommendationHash: praiseHash,
          reviewText: "Crimson Desert works great for me and I have no issues.",
          sourceCreatedAt: "2026-07-05T10:05:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:35:00.000Z",
          votedUp: true,
          playtimeAtReviewMinutes: 180,
        },
      ],
      totals: { totalReviews: 1_250, totalPositive: 1_000, totalNegative: 250 },
      cursor: null,
    });

    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.signalsInserted).toBe(1);
    const steamSignals = tables.source_signals.filter((row) => row.source === "steam_review");
    expect(steamSignals).toHaveLength(1);
    expect(tables.issue_clusters).toHaveLength(0);
    expect(steamSignals[0]).toMatchObject({
      cluster_id: null,
      source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
      raw_text: "Since patch 1.13 the game stutters and crashes every ten minutes on Steam.",
      public_status: "private",
      extracted_facts: {
        steamVotedUp: false,
        playtimeAtReviewMinutes: 420,
        sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
      },
    });

    expect(tables.steam_review_receipts).toHaveLength(2);
    expect(tables.steam_review_receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recommendation_hash: issueHash, voted_up: false }),
        expect.objectContaining({ recommendation_hash: praiseHash, voted_up: true }),
      ]),
    );
    for (const receipt of tables.steam_review_receipts) {
      expect(receipt).not.toHaveProperty("review_text");
      expect(receipt).not.toHaveProperty("author");
      expect(receipt).not.toHaveProperty("steam_id");
    }

    expect(tables.steam_pulse_snapshots).toHaveLength(1);
    expect(tables.steam_pulse_snapshots[0]).toMatchObject({
      total_reviews: 1_250,
      total_positive: 1_000,
      total_negative: 250,
      positive_percentage: 80,
      reviews_scanned: 2,
      issue_language_count: 1,
      leads_retained: 1,
    });
    expect(rejectedCandidateRows()).toHaveLength(0);
  });

  it("does not apply shared URL feedback rules to individual Steam reviews", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    resetDb({
      scanner_feedback_rules: [
        {
          id: "rule-steam-domain",
          action: "block",
          decision: "not_issue_report",
          scope_type: "source_domain",
          scope_value: "steampowered.com",
          created_at: "2026-07-05T11:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
    });
    const recommendationHash = externalIdHash("steam_review", "shared-url-feedback");
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [
        {
          recommendationHash,
          reviewText: "Crimson Desert stutters and crashes every ten minutes after patch 1.13.",
          sourceCreatedAt: "2026-07-05T10:00:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 420,
        },
      ],
      totals: { totalReviews: 1_250, totalPositive: 1_000, totalNegative: 250 },
      cursor: null,
    });

    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.operatorRulesMatched).toBe(0);
    expect(result.signalsInserted).toBe(1);
    expect(sourceSignalRows()).toEqual([
      expect.objectContaining({ source: "steam_review", external_id_hash: recommendationHash }),
    ]);
    expect(rejectedCandidateRows()).toHaveLength(0);
    expect(tables.steam_review_receipts).toEqual([
      expect.objectContaining({ recommendation_hash: recommendationHash }),
    ]);
  });

  it("acknowledges only classified or successfully persisted reviews after a partial write", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";

    const firstHash = externalIdHash("steam_review", "recommendation-first");
    const retryHash = externalIdHash("steam_review", "recommendation-retry");
    sourceSignalInsertFailure = { externalHash: retryHash, message: "second Steam signal write failed" };
    configureProviders();
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [
        {
          recommendationHash: firstHash,
          reviewText: "Crimson Desert stutters constantly after patch 1.13 on Steam.",
          sourceCreatedAt: "2026-07-05T10:00:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:30:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 420,
        },
        {
          recommendationHash: retryHash,
          reviewText: "Crimson Desert crashes every ten minutes after patch 1.13 on Steam.",
          sourceCreatedAt: "2026-07-05T10:05:00.000Z",
          sourceUpdatedAt: "2026-07-05T10:35:00.000Z",
          votedUp: false,
          playtimeAtReviewMinutes: 180,
        },
      ],
      totals: { totalReviews: 1_250, totalPositive: 1_000, totalNegative: 250 },
      cursor: null,
    });

    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("partial");
    expect(result.signalsPrepared).toBe(2);
    expect(result.signalsInserted).toBe(1);
    expect(tables.steam_review_receipts).toEqual([
      expect.objectContaining({ recommendation_hash: firstHash }),
    ]);
    expect(tables.steam_review_receipts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ recommendation_hash: retryHash })]),
    );
    expect(tables.steam_pulse_snapshots[0]).toMatchObject({
      reviews_scanned: 2,
      issue_language_count: 2,
      leads_retained: 1,
    });
  });

  it("keeps the daily review delta anchored to the prior day across same-day refreshes", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.STEAM_PULSE_ENABLED = "true";
    resetDb({
      steam_pulse_snapshots: [
        {
          snapshot_day: "2026-07-04",
          collected_at: "2026-07-04T23:00:00.000Z",
          total_reviews: 1_235,
          total_positive: 986,
          total_negative: 249,
          positive_percentage: 79.8,
          review_count_delta: 5,
          reviews_scanned: 0,
          issue_language_count: 0,
          leads_retained: 0,
        },
        {
          snapshot_day: "2026-07-05",
          collected_at: "2026-07-05T05:00:00.000Z",
          total_reviews: 1_240,
          total_positive: 990,
          total_negative: 250,
          positive_percentage: 79.8,
          review_count_delta: 4,
          reviews_scanned: 0,
          issue_language_count: 0,
          leads_retained: 0,
        },
      ],
    });
    configureProviders();
    mocks.fetchSteamReviewBatch.mockResolvedValue({
      reviews: [],
      totals: { totalReviews: 1_250, totalPositive: 1_000, totalNegative: 250 },
      cursor: null,
    });

    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(tables.steam_pulse_snapshots).toHaveLength(2);
    expect(tables.steam_pulse_snapshots[1]).toMatchObject({
      collected_at: "2026-07-05T12:00:00.000Z",
      total_reviews: 1_250,
      review_count_delta: 15,
    });
  });

  it("finalizes against the legacy run ledger before the feedback migration is applied", async () => {
    updateFailure = {
      table: "automation_runs",
      column: "operator_rules_matched",
      code: "PGRST204",
      message: "Could not find the operator_rules_matched column of automation_runs in the schema cache",
    };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.errors).not.toContain(expect.stringContaining("finalize"));
    expect(tables.automation_runs[0]).toMatchObject({
      status: expect.not.stringMatching(/^running$/),
      finished_at: expect.any(String),
    });
    expect(tables.automation_runs[0]).not.toHaveProperty("operator_rules_matched");
  });
});

describe("Platform Pulse intake", () => {
  it("persists public metadata and live aggregates without provider credentials or channel identity", async () => {
    delete process.env.TAVILY_API_KEY;
    process.env.TWITCH_CLIENT_ID = "fixture-client-id";
    process.env.TWITCH_CLIENT_SECRET = "fixture-client-secret";
    mocks.fetchCrimsonDesertPlatformContext.mockResolvedValue({
      capturedAt: "2026-07-05T12:00:00.000Z",
      igdb: {
        status: "ok",
        error: null,
        data: {
          id: 77,
          name: "Crimson Desert",
          slug: "crimson-desert",
          summary: "Public IGDB metadata.",
          firstReleaseDate: "2026-03-19T00:00:00.000Z",
          platforms: ["PC", "PlayStation 5"],
        },
      },
      twitch: {
        status: "ok",
        error: null,
        data: { liveStreamCount: 14, liveViewerCount: 932, isComplete: true },
      },
    });

    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(tables.platform_context_snapshots).toHaveLength(1);
    expect(tables.platform_context_snapshots[0]).toMatchObject({
      igdb_status: "ok",
      igdb_game_id: 77,
      igdb_name: "Crimson Desert",
      igdb_platforms: ["PC", "PlayStation 5"],
      twitch_status: "ok",
      twitch_live_streams: 14,
      twitch_live_viewers: 932,
      twitch_complete: true,
    });
    const serialized = JSON.stringify(tables.platform_context_snapshots);
    expect(serialized).not.toContain("fixture-client-secret");
    expect(serialized).not.toContain("channel");
    expect(serialized).not.toContain("stream_title");
  });

  it("keeps a missing pre-migration platform table as a safe compatibility skip", async () => {
    process.env.TWITCH_CLIENT_ID = "fixture-client-id";
    process.env.TWITCH_CLIENT_SECRET = "fixture-client-secret";
    selectFailure = {
      table: "platform_context_snapshots",
      message: "relation platform_context_snapshots does not exist",
    };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("success");
    expect(result.skips).toContain("platform_context_schema_unavailable");
    expect(result.errors).not.toContain(expect.stringContaining("Platform context"));
  });

  it("marks unexpected platform persistence failures partial and records the error", async () => {
    process.env.TWITCH_CLIENT_ID = "fixture-client-id";
    process.env.TWITCH_CLIENT_SECRET = "fixture-client-secret";
    selectFailure = { table: "platform_context_snapshots", message: "permission denied" };
    configureProviders();
    const { runAutomationMonitor } = await importRunner();

    const result = await runAutomationMonitor({ mode: "manual", now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.status).toBe("partial");
    expect(result.skips).toContain("platform_context_failed");
    expect(result.errors).toContain("platform context recency read failed: permission denied");
  });
});


describe("Steam player snapshot collection", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    process.env.STEAM_PLAYER_COUNTS_ENABLED = "true";
    mocks.fetchSteamCurrentPlayers.mockReset();
    mocks.fetchSteamCurrentPlayers.mockResolvedValue({ capturedAt: "2026-07-05T12:02:03.000Z", playerCount: 12345 });
  });

  it("records only timestamped counts without creating player evidence or using paid providers", async () => {
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "0";
    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now });
    expect(result.status).toBe("success");
    expect(tables.steam_player_snapshots).toHaveLength(1);
    expect(tables.steam_player_snapshots[0]).toMatchObject({ sample_hour: "2026-07-05T12:00:00.000Z", captured_at: "2026-07-05T12:02:03.000Z", player_count: 12345 });
    expect(result.signalsInserted).toBe(0);
    expect(result.clustersPromoted).toBe(0);
    expect(tables.steam_review_receipts).toHaveLength(0);
    expect(tables.source_signals).toHaveLength(0);
    expect(mocks.fetchSteamReviewBatch).not.toHaveBeenCalled();
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
    expect(result.llmCallsUsed).toBe(0);
  });

  it.each(["disabled", "dry_run"])("does not read, fetch or write when %s", async condition => {
    if (condition === "disabled") delete process.env.STEAM_PLAYER_COUNTS_ENABLED;
    const { runAutomationMonitor } = await importRunner();
    await runAutomationMonitor({ mode: condition === "dry_run" ? "dry_run" : "manual", now });
    expect(mocks.from).not.toHaveBeenCalledWith("steam_player_snapshots");
    expect(mocks.fetchSteamCurrentPlayers).not.toHaveBeenCalled();
    expect(tables.steam_player_snapshots).toHaveLength(0);
  });

  it("safely skips the new lane before migration, without a provider call", async () => {
    selectFailure = { table: "steam_player_snapshots", code: "42P01", message: "relation steam_player_snapshots does not exist" };
    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now });
    expect(result.status).toBe("success");
    expect(result.skips).toContain("steam_players_schema_unavailable");
    expect(mocks.fetchSteamCurrentPlayers).not.toHaveBeenCalled();
  });

  it.each(["read", "write", "provider"])("keeps a %s failure visible without a false zero reading", async kind => {
    if (kind === "read") selectFailure = { table: "steam_player_snapshots", code: "42501", message: "permission denied" };
    if (kind === "write") insertFailure = { table: "steam_player_snapshots", code: "42501", message: "permission denied" };
    if (kind === "provider") mocks.fetchSteamCurrentPlayers.mockRejectedValue(new Error("Steam player count response was malformed"));
    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now });
    expect(result.status).toBe("partial");
    expect(result.skips).toContain("steam_players_failed");
    expect(result.errors.join(" ")).toContain(kind === "provider" ? "malformed" : "permission denied");
    expect(tables.steam_player_snapshots).toHaveLength(0);
  });

  it.each([["2026-07-05T11:00:00.001Z", false], ["2026-07-05T11:00:00.000Z", true]] as const)("applies the one-hour recency boundary to %s", async (captured_at, shouldFetch) => {
    tables.steam_player_snapshots.push({ sample_hour: "2026-07-05T11:00:00.000Z", captured_at, player_count: 9000 });
    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now });
    expect(mocks.fetchSteamCurrentPlayers).toHaveBeenCalledTimes(shouldFetch ? 1 : 0);
    expect(tables.steam_player_snapshots).toHaveLength(shouldFetch ? 2 : 1);
    if (!shouldFetch) expect(result.skips).toContain("steam_players_recent");
  });

  it("preserves the first reading if another run wins the hourly insert race", async () => {
    mocks.fetchSteamCurrentPlayers.mockImplementation(async () => {
      tables.steam_player_snapshots.push({ sample_hour: "2026-07-05T12:00:00.000Z", captured_at: "2026-07-05T12:01:00.000Z", player_count: 10000 });
      return { capturedAt: "2026-07-05T12:02:03.000Z", playerCount: 12345 };
    });
    const { runAutomationMonitor } = await importRunner();
    const result = await runAutomationMonitor({ mode: "manual", now });
    expect(result.status).toBe("success");
    expect(tables.steam_player_snapshots).toHaveLength(1);
    expect(tables.steam_player_snapshots[0].player_count).toBe(10000);
  });
});
