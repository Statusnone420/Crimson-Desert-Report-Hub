import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  redirect: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from }) }));

type TableName = "bug_reports" | "approved_excerpts";

let insertFailure: { table: TableName; message: string } | null = null;
const mutations: { table: TableName; type: "insert" | "update"; row: unknown }[] = [];

class FakeQuery {
  private filters: { column: string; value: unknown }[] = [];
  private insertRow: Record<string, unknown> | null = null;
  private patch: Record<string, unknown> | null = null;

  constructor(private readonly table: TableName) {}

  insert(row: Record<string, unknown>) {
    this.insertRow = row;
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    if (this.insertRow) {
      if (insertFailure?.table === this.table) return { data: null, error: { message: insertFailure.message } };
      mutations.push({ table: this.table, type: "insert", row: this.insertRow });
      return { data: [this.insertRow], error: null };
    }

    if (this.patch) {
      mutations.push({ table: this.table, type: "update", row: { patch: this.patch, filters: this.filters } });
      return { data: [this.patch], error: null };
    }

    return { data: [], error: null };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  insertFailure = null;
  mutations.length = 0;
  mocks.from.mockImplementation((table: TableName) => new FakeQuery(table));
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
