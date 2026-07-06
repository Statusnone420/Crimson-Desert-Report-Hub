import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  redirect: vi.fn(),
  requireAdmin: vi.fn(),
  rescueCandidateSignal: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  runAutomationMonitor: vi.fn(),
  unstableCache: vi.fn((fn: unknown) => fn),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
  unstable_cache: mocks.unstableCache,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/automation/run", () => ({
  runAutomationMonitor: mocks.runAutomationMonitor,
  rescueCandidateSignal: mocks.rescueCandidateSignal,
}));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from }) }));

type TableName = "bug_reports" | "approved_excerpts" | "automation_rejected_candidates";
type AdminTableName = TableName | "automation_settings";

let insertFailure: { table: TableName; message: string } | null = null;
let seedRows: Partial<Record<AdminTableName, Record<string, unknown>[]>> = {};
const mutations: { table: AdminTableName; type: "insert" | "update" | "upsert"; row: unknown }[] = [];

class FakeQuery {
  private filters: { column: string; value: unknown }[] = [];
  private insertRow: Record<string, unknown> | null = null;
  private limitCount: number | null = null;
  private patch: Record<string, unknown> | null = null;
  private selecting = false;
  private upsertRow: Record<string, unknown> | null = null;

  constructor(private readonly table: AdminTableName) {}

  select() {
    this.selecting = true;
    return this;
  }

  insert(row: Record<string, unknown>) {
    this.insertRow = row;
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.patch = patch;
    return this;
  }

  upsert(row: Record<string, unknown>) {
    this.upsertRow = row;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
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
      mutations.push({ table: this.table, type: "upsert", row: this.upsertRow });
      return { data: [this.upsertRow], error: null };
    }

    if (this.insertRow) {
      if (insertFailure?.table === this.table) return { data: null, error: { message: insertFailure.message } };
      mutations.push({ table: this.table, type: "insert", row: this.insertRow });
      return { data: [this.insertRow], error: null };
    }

    if (this.patch) {
      mutations.push({ table: this.table, type: "update", row: { patch: this.patch, filters: this.filters } });
      return { data: [this.patch], error: null };
    }

    if (this.selecting) {
      const rows = (seedRows[this.table] ?? []).filter((row) =>
        this.filters.every((filter) => row[filter.column] === filter.value),
      );
      const limited = this.limitCount !== null ? rows.slice(0, this.limitCount) : rows;
      return { data: limited, error: null };
    }

    return { data: [], error: null };
  }
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.clearAllMocks();
  vi.resetModules();
  insertFailure = null;
  seedRows = {};
  mutations.length = 0;
  mocks.from.mockImplementation((table: AdminTableName) => new FakeQuery(table));
});

describe("moderateReport", () => {
  it("fails approved moderation when the public excerpt cannot be saved", async () => {
    insertFailure = { table: "approved_excerpts", message: "excerpt insert failed" };
    const { moderateReport } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "report-one");
    formData.set("decision", "approved");
    formData.set("cluster_id", "cluster-one");
    formData.set("excerpt", "Frame rate drops after the patch.");

    await expect(moderateReport(formData)).rejects.toThrow("excerpt insert failed");

    expect(mutations).toContainEqual({
      table: "bug_reports",
      type: "update",
      row: {
        patch: { moderation_status: "approved", cluster_id: "cluster-one" },
        filters: [{ column: "id", value: "report-one" }],
      },
    });
    expect(mutations.some((mutation) => mutation.table === "approved_excerpts")).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setAutomationPaused", () => {
  it("blocks scanner setting writes in Vercel preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const { setAutomationPaused } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("paused", "true");

    await expect(setAutomationPaused(formData)).rejects.toThrow("preview writes disabled");

    expect(mutations).toEqual([]);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("persists scanner pause state behind admin auth", async () => {
    const { setAutomationPaused } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("paused", "true");

    await setAutomationPaused(formData);

    expect(mutations).toContainEqual({
      table: "automation_settings",
      type: "upsert",
      row: expect.objectContaining({
        key: "scanner",
        value: { paused: true },
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/source-monitor");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("runAutomationCappedScan", () => {
  it("revalidates the admin dashboard after a manual scanner run", async () => {
    mocks.runAutomationMonitor.mockResolvedValue({ status: "success" });
    const { runAutomationCappedScan } = await import("@/app/admin/actions");

    await runAutomationCappedScan();

    expect(mocks.runAutomationMonitor).toHaveBeenCalledWith({ mode: "manual" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/source-monitor");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("rescueRejectedCandidate", () => {
  it("reads the rejected candidate, persists it as a signal, and marks it rescued", async () => {
    seedRows = {
      automation_rejected_candidates: [
        {
          id: "rejected-one",
          title: "Nice scenery tour",
          url: "https://example.com/scenery",
          source_domain: "example.com",
          snippet: "beautiful vistas but actually a crash report",
          reason: "source_not_issue_report",
        },
      ],
    };
    mocks.rescueCandidateSignal.mockResolvedValue(undefined);
    const { rescueRejectedCandidate } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "rejected-one");

    await rescueRejectedCandidate(formData);

    expect(mocks.rescueCandidateSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Nice scenery tour",
        url: "https://example.com/scenery",
        sourceDomain: "example.com",
        snippet: "beautiful vistas but actually a crash report",
      }),
    );
    expect(mutations).toContainEqual({
      table: "automation_rejected_candidates",
      type: "update",
      row: {
        patch: expect.objectContaining({ rescued_at: expect.any(String) }),
        filters: [{ column: "id", value: "rejected-one" }],
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/source-monitor");
  });

  it("throws when the rejected candidate id is missing", async () => {
    const { rescueRejectedCandidate } = await import("@/app/admin/actions");
    const formData = new FormData();

    await expect(rescueRejectedCandidate(formData)).rejects.toThrow("bad input");
    expect(mocks.rescueCandidateSignal).not.toHaveBeenCalled();
  });

  it("throws when the rejected candidate cannot be found", async () => {
    seedRows = { automation_rejected_candidates: [] };
    const { rescueRejectedCandidate } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "missing-candidate");

    await expect(rescueRejectedCandidate(formData)).rejects.toThrow("rejected candidate not found");
    expect(mocks.rescueCandidateSignal).not.toHaveBeenCalled();
  });
});
