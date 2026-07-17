import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchLatestOfficialPatchNote: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/officialPatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/officialPatch")>();
  return {
    ...actual,
    fetchLatestOfficialPatchNote: mocks.fetchLatestOfficialPatchNote,
  };
});

type TableName = "official_patch_notes" | "official_patch_claimed_fixes";
type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

const tables: Record<TableName, Row[]> = {
  official_patch_notes: [],
  official_patch_claimed_fixes: [],
};
const mutations: { table: TableName; type: "insert" | "update" | "upsert" | "delete"; row: unknown; filters: Filter[] }[] = [];
let selectFailure: TableName | null = null;

class FakeQuery {
  private filters: Filter[] = [];
  private insertRows: Row[] | null = null;
  private isDelete = false;
  private orderColumn: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;
  private patch: Row | null = null;
  private selecting = false;
  private upsertRow: Row | null = null;

  constructor(private readonly table: TableName) {}

  select() {
    this.selecting = true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row) {
    this.patch = patch;
    return this;
  }

  upsert(row: Row) {
    this.upsertRow = row;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    if (this.upsertRow) {
      const key = "board_no";
      const existingIndex = tables[this.table].findIndex((row) => row[key] === this.upsertRow?.[key]);
      if (existingIndex >= 0) tables[this.table][existingIndex] = { ...tables[this.table][existingIndex], ...this.upsertRow };
      else tables[this.table].push({ ...this.upsertRow });
      mutations.push({ table: this.table, type: "upsert", row: this.upsertRow, filters: this.filters });
      return { data: [this.upsertRow], error: null };
    }

    if (this.insertRows) {
      mutations.push({ table: this.table, type: "insert", row: this.insertRows, filters: this.filters });
      tables[this.table].push(...this.insertRows.map((row) => ({ ...row })));
      return { data: this.insertRows, error: null };
    }

    if (this.isDelete) {
      mutations.push({ table: this.table, type: "delete", row: null, filters: this.filters });
      tables[this.table] = tables[this.table].filter(
        (row) => !this.filters.every((filter) => row[filter.column] === filter.value),
      );
      return { data: [], error: null };
    }

    if (this.patch) {
      mutations.push({ table: this.table, type: "update", row: this.patch, filters: this.filters });
      tables[this.table] = tables[this.table].map((row) =>
        this.filters.every((filter) => row[filter.column] === filter.value) ? { ...row, ...this.patch } : row,
      );
      return { data: [this.patch], error: null };
    }

    if (this.selecting) {
      if (selectFailure === this.table) return { data: null, error: { message: `${this.table} read failed` } };
      let rows = tables[this.table].filter((row) => this.filters.every((filter) => row[filter.column] === filter.value));
      if (this.orderColumn) {
        const column = this.orderColumn;
        rows = [...rows].sort((a, b) => {
          const aVal = String(a[column] ?? "");
          const bVal = String(b[column] ?? "");
          return this.orderAscending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        });
      }
      const limited = this.limitCount !== null ? rows.slice(0, this.limitCount) : rows;
      return { data: limited, error: null };
    }

    return { data: [], error: null };
  }
}

function resetDb() {
  tables.official_patch_notes = [];
  tables.official_patch_claimed_fixes = [];
  mutations.length = 0;
  selectFailure = null;
}

function fakeSupabase() {
  return { from: (table: TableName) => new FakeQuery(table) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resetDb();
});

const note = {
  boardNo: "105",
  title: "Patch Notes Version 1.13.00",
  patchVersion: "1.13.00",
  officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
  publishedAt: "2026-07-03T03:00:00.000Z",
  summary: "Stability improvements.",
  claimedFixes: ["Fixed an issue where the map crashed the game.", "Fixed FPS drops during combat."],
};

describe("syncOfficialPatchNote claimed fixes persistence", () => {
  it("deletes existing rows for the board then inserts claimed fixes with positions", async () => {
    mocks.fetchLatestOfficialPatchNote.mockResolvedValue(note);
    tables.official_patch_claimed_fixes.push({ board_no: "105", position: 0, fix_text: "stale row", category: null });

    const { syncOfficialPatchNote } = await import("@/lib/officialPatch.server");
    const supabase = fakeSupabase();

    const result = await syncOfficialPatchNote(supabase, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.status).toBe("synced");

    const deleteMutation = mutations.find(
      (mutation) => mutation.table === "official_patch_claimed_fixes" && mutation.type === "delete",
    );
    expect(deleteMutation?.filters).toEqual([{ column: "board_no", value: "105" }]);

    const insertMutation = mutations.find(
      (mutation) => mutation.table === "official_patch_claimed_fixes" && mutation.type === "insert",
    );
    expect(insertMutation?.row).toEqual([
      { board_no: "105", position: 0, fix_text: "Fixed an issue where the map crashed the game.", category: "crash_startup" },
      { board_no: "105", position: 1, fix_text: "Fixed FPS drops during combat.", category: "performance" },
    ]);

    // stale row was cleared, only the fresh two remain
    expect(tables.official_patch_claimed_fixes).toHaveLength(2);
  });

  it("clears prior rows and inserts nothing when the note has no claimed fixes", async () => {
    mocks.fetchLatestOfficialPatchNote.mockResolvedValue({ ...note, claimedFixes: [] });
    tables.official_patch_claimed_fixes.push({ board_no: "105", position: 0, fix_text: "stale row", category: null });

    const { syncOfficialPatchNote } = await import("@/lib/officialPatch.server");
    const supabase = fakeSupabase();

    await syncOfficialPatchNote(supabase, { now: new Date("2026-07-05T00:00:00.000Z") });

    const insertMutation = mutations.find(
      (mutation) => mutation.table === "official_patch_claimed_fixes" && mutation.type === "insert",
    );
    expect(insertMutation).toBeUndefined();
    expect(tables.official_patch_claimed_fixes).toHaveLength(0);
  });

  it("preserves the original observation time when the current patch is synced again", async () => {
    mocks.fetchLatestOfficialPatchNote.mockResolvedValue(note);
    tables.official_patch_notes.push({
      board_no: note.boardNo,
      title: note.title,
      patch_version: note.patchVersion,
      official_url: note.officialUrl,
      published_at: note.publishedAt,
      summary: note.summary,
      observed_at: "2026-07-03T04:00:00.000Z",
      is_current: true,
    });

    const { syncOfficialPatchNote } = await import("@/lib/officialPatch.server");
    const result = await syncOfficialPatchNote(fakeSupabase(), { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result).toMatchObject({
      status: "synced",
      changed: false,
      patch: { observedAt: "2026-07-03T04:00:00.000Z" },
    });
    expect(mutations.find((mutation) => mutation.table === "official_patch_notes" && mutation.type === "upsert")?.row).toMatchObject({
      observed_at: "2026-07-03T04:00:00.000Z",
    });
  });
});

describe("getClaimedFixesForCurrentPatch", () => {
  it("returns claimed fixes for the current patch's board, ordered by position", async () => {
    tables.official_patch_notes.push({ board_no: "105", is_current: true, published_at: "2026-07-03T03:00:00.000Z" });
    tables.official_patch_claimed_fixes.push(
      { board_no: "105", position: 1, fix_text: "Second fix.", category: "performance" },
      { board_no: "105", position: 0, fix_text: "First fix.", category: null },
    );

    const { getClaimedFixesForCurrentPatch } = await import("@/lib/officialPatch.server");
    const result = await getClaimedFixesForCurrentPatch(fakeSupabase());

    expect(result).toEqual([
      { fixText: "First fix.", category: null },
      { fixText: "Second fix.", category: "performance" },
    ]);
  });

  it("returns an empty array when there is no current patch row", async () => {
    const { getClaimedFixesForCurrentPatch } = await import("@/lib/officialPatch.server");
    const result = await getClaimedFixesForCurrentPatch(fakeSupabase());
    expect(result).toEqual([]);
  });

  it("returns an empty array instead of throwing when the current-patch read errors", async () => {
    selectFailure = "official_patch_notes";
    const { getClaimedFixesForCurrentPatch } = await import("@/lib/officialPatch.server");
    const result = await getClaimedFixesForCurrentPatch(fakeSupabase());
    expect(result).toEqual([]);
  });

  it("returns an empty array instead of throwing when the fixes read errors", async () => {
    tables.official_patch_notes.push({ board_no: "105", is_current: true, published_at: "2026-07-03T03:00:00.000Z" });
    selectFailure = "official_patch_claimed_fixes";
    const { getClaimedFixesForCurrentPatch } = await import("@/lib/officialPatch.server");
    const result = await getClaimedFixesForCurrentPatch(fakeSupabase());
    expect(result).toEqual([]);
  });
});

describe("patchVersionOptions", () => {
  it("offers current, one previous, and other", async () => {
    const { patchVersionOptions } = await import("@/lib/officialPatch.server");
    expect(patchVersionOptions("1.13.02", "1.13.01")).toEqual(["1.13.02", "1.13.01", "other"]);
  });

  it("collapses a previous version equal to current", async () => {
    const { patchVersionOptions } = await import("@/lib/officialPatch.server");
    expect(patchVersionOptions("1.13.02", "1.13.02")).toEqual(["1.13.02", "other"]);
  });

  it("offers current and other when no previous patch is known", async () => {
    const { patchVersionOptions } = await import("@/lib/officialPatch.server");
    expect(patchVersionOptions("1.13.02", null)).toEqual(["1.13.02", "other"]);
  });
});

describe("getReportPatchContext", () => {
  const officialRow = (overrides: Record<string, unknown>) => ({
    title: "Patch Notes",
    official_url: "https://example.com/note",
    summary: null,
    ...overrides,
  });

  it("derives the previous patch from the newest non-current note", async () => {
    tables.official_patch_notes.push(
      officialRow({ board_no: "106", patch_version: "1.13.01", published_at: "2026-07-08T05:00:00.000Z", is_current: true }),
      officialRow({ board_no: "105", patch_version: "1.13.00", published_at: "2026-07-03T03:00:00.000Z", is_current: false }),
      officialRow({ board_no: "90", patch_version: "1.12.00", published_at: "2026-06-01T03:00:00.000Z", is_current: false }),
    );

    const { getReportPatchContext } = await import("@/lib/officialPatch.server");
    const context = await getReportPatchContext(fakeSupabase());

    expect(context.currentPatch.version).toBe("1.13.01");
    expect(context.currentPatch.source).toBe("official");
    expect(context.patchVersions).toEqual(["1.13.01", "1.13.00", "other"]);
  });

  it("skips a non-current row that repeats the current version", async () => {
    tables.official_patch_notes.push(
      officialRow({ board_no: "106", patch_version: "1.13.01", published_at: "2026-07-08T05:00:00.000Z", is_current: true }),
      officialRow({ board_no: "manual-1.13.01", patch_version: "1.13.01", published_at: "2026-07-07T05:00:00.000Z", is_current: false }),
      officialRow({ board_no: "105", patch_version: "1.13.00", published_at: "2026-07-03T03:00:00.000Z", is_current: false }),
    );

    const { getReportPatchContext } = await import("@/lib/officialPatch.server");
    const context = await getReportPatchContext(fakeSupabase());

    expect(context.patchVersions).toEqual(["1.13.01", "1.13.00", "other"]);
  });

  it("offers only current and other when no prior notes exist", async () => {
    tables.official_patch_notes.push(
      officialRow({ board_no: "106", patch_version: "1.13.01", published_at: "2026-07-08T05:00:00.000Z", is_current: true }),
    );

    const { getReportPatchContext } = await import("@/lib/officialPatch.server");
    const context = await getReportPatchContext(fakeSupabase());

    expect(context.patchVersions).toEqual(["1.13.01", "other"]);
  });

  it("falls back to the hardcoded floor when reads fail", async () => {
    selectFailure = "official_patch_notes";

    const { getReportPatchContext } = await import("@/lib/officialPatch.server");
    const context = await getReportPatchContext(fakeSupabase());

    expect(context.currentPatch.source).toBe("fallback");
    expect(context.patchVersions).toEqual(["1.13.01", "other"]);
  });
});

describe("isValidPatchVersion", () => {
  it("accepts scraper-shaped versions", async () => {
    const { isValidPatchVersion } = await import("@/lib/officialPatch");
    for (const version of ["1.13.02", "1.14", "12.1.3"]) {
      expect(isValidPatchVersion(version)).toBe(true);
    }
  });

  it("rejects everything else", async () => {
    const { isValidPatchVersion } = await import("@/lib/officialPatch");
    for (const version of ["", "other", "1", "1.", "1.13.001", "v1.13", "1.13 ", "1..13"]) {
      expect(isValidPatchVersion(version)).toBe(false);
    }
  });
});
