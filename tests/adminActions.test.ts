import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchNewPosts: vi.fn(),
  getRedditToken: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
  requireAdmin: vi.fn(),
  rescueCandidateSignal: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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
  rescueCandidateSignal: mocks.rescueCandidateSignal,
}));
vi.mock("@/lib/officialPatch.server", () => ({
  getCurrentPatchMetadata: vi.fn(async () => ({ version: "1.13.01", publishedAt: "2026-07-08T00:00:00Z" })),
}));
vi.mock("@/lib/reddit.server", () => ({
  fetchNewPosts: mocks.fetchNewPosts,
  getRedditToken: mocks.getRedditToken,
}));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

type TableName = "bug_reports" | "approved_excerpts" | "automation_rejected_candidates" | "issue_clusters";
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
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runRedditMonitor", () => {
  it("stays permanently disabled when legacy Reddit credentials remain", async () => {
    vi.stubEnv("REDDIT_CLIENT_ID", "legacy-id");
    vi.stubEnv("REDDIT_CLIENT_SECRET", "legacy-secret");
    vi.stubEnv("REDDIT_USER_AGENT", "legacy-agent");
    mocks.getRedditToken.mockResolvedValue("legacy-token");
    mocks.fetchNewPosts.mockResolvedValue([]);
    const { runRedditMonitor } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("subreddits", "CrimsonDesert");

    await expect(runRedditMonitor(formData)).rejects.toThrow("reddit monitor permanently disabled");
    expect(mocks.getRedditToken).not.toHaveBeenCalled();
    expect(mocks.fetchNewPosts).not.toHaveBeenCalled();
  });
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

describe("setClusterFixStatus", () => {
  it("manual status changes set an admin override and owner-readable reason", async () => {
    const { setClusterFixStatus } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("fix_status", "verified_fixed");

    await setClusterFixStatus(formData);

    expect(mutations).toContainEqual({
      table: "issue_clusters",
      type: "update",
      row: {
        patch: {
          fix_status: "verified_fixed",
          fix_claimed_at: expect.any(String),
          fix_claimed_patch_version: "1.13.01",
          admin_override: true,
          lifecycle_reason: "Locked by you. Manual status set to Marked fixed by maintainer.",
        },
        filters: [{ column: "id", value: "cluster-one" }],
      },
    });
  });
});

describe("clearClusterFixStatusOverride", () => {
  it("clears only the override fields so automation can re-derive status", async () => {
    const { clearClusterFixStatusOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");

    await clearClusterFixStatusOverride(formData);

    expect(mutations).toContainEqual({
      table: "issue_clusters",
      type: "update",
      row: {
        patch: { admin_override: false, lifecycle_reason: null },
        filters: [{ column: "id", value: "cluster-one" }],
      },
    });
  });
});

describe("setClusterVisibilityOverride", () => {
  it("force_public writes the escape hatch and immediately refreshes effective visibility", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "force_public");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "force_public",
    });
  });

  it("force_hidden removes a quiet cluster from public reads before the deeper refresh", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "force_hidden");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "force_hidden",
    });
  });

  it("auto clears the override back to engine control", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "auto");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "auto",
    });
  });

  it("rejects unknown visibility values", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "yeet");

    await expect(setClusterVisibilityOverride(formData)).rejects.toThrow("bad input");
    expect(mutations).toEqual([]);
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
        value: expect.objectContaining({ paused: true }),
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/source-monitor");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("setScannerPolicy", () => {
  it("persists a clamped scanner policy behind admin auth", async () => {
    const { setScannerPolicy } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("paused", "true");
    formData.set("minIntervalMinutes", "120");
    formData.set("scheduledSearchCreditsPerRun", "3");
    formData.set("monthlyTavilyCreditCap", "-5");
    formData.set("monthlyLlmUsdCap", "7");
    formData.set("modelPreset", "expensive-model");

    await setScannerPolicy(formData);

    expect(mutations).toContainEqual({
      table: "automation_settings",
      type: "upsert",
      row: expect.objectContaining({
        key: "scanner",
        value: {
          paused: true,
          minIntervalMinutes: 120,
          scheduledSearchCreditsPerRun: 3,
          monthlyTavilyCreditCap: 1000,
          monthlyLlmUsdCap: 2,
          modelPreset: "deepseek_v4_flash",
        },
      }),
    });
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
          source_published_at: "2026-07-05T10:00:00.000Z",
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
        sourcePublishedAt: "2026-07-05T10:00:00.000Z",
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
