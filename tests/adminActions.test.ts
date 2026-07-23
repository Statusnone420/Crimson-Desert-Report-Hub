import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchNewPosts: vi.fn(),
  getRedditToken: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
  refreshClusterVisibility: vi.fn(),
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
  refreshClusterVisibility: mocks.refreshClusterVisibility,
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

type TableName =
  | "bug_reports"
  | "approved_excerpts"
  | "automation_rejected_candidates"
  | "issue_clusters"
  | "scanner_decisions"
  | "source_signals";
type AdminTableName = TableName | "automation_settings" | "official_patch_notes";

let insertFailure: { table: TableName; message: string } | null = null;
let upsertFailure: { table: AdminTableName; message: string } | null = null;
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
      if (upsertFailure?.table === this.table) return { data: null, error: { message: upsertFailure.message } };
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
  mocks.refreshClusterVisibility.mockReset();
  mocks.refreshClusterVisibility.mockResolvedValue(undefined);
  vi.resetModules();
  insertFailure = null;
  upsertFailure = null;
  seedRows = {
    bug_reports: [{ id: "report-one", moderation_status: "pending", cluster_id: null }],
  };
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
  it("refreshes automatic visibility after approving a clustered report", async () => {
    const { moderateReport } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "report-one");
    formData.set("decision", "approved");
    formData.set("cluster_id", "cluster-one");

    await moderateReport(formData);

    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-one");
  });

  it("keeps the approved excerpt when the best-effort visibility refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.refreshClusterVisibility.mockImplementationOnce(async () => {
      expect(mutations.some((mutation) => mutation.table === "approved_excerpts")).toBe(true);
      throw new Error("refresh failed");
    });
    const { moderateReport } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "report-one");
    formData.set("decision", "approved");
    formData.set("cluster_id", "cluster-one");
    formData.set("excerpt", "Frame rate drops after the patch.");

    await moderateReport(formData);

    expect(mutations).toContainEqual({
      table: "bug_reports",
      type: "update",
      row: {
        patch: { moderation_status: "approved", cluster_id: "cluster-one" },
        filters: [{ column: "id", value: "report-one" }],
      },
    });
    expect(mutations.some((mutation) => mutation.table === "approved_excerpts")).toBe(true);
    expect(consoleError).toHaveBeenCalledWith("cluster visibility refresh failed:", expect.any(Error));
    consoleError.mockRestore();
  });

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

  it("refreshes the old cluster when an approved report is rejected", async () => {
    seedRows = {
      bug_reports: [{ id: "report-one", moderation_status: "approved", cluster_id: "cluster-old" }],
    };
    const { moderateReport } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "report-one");
    formData.set("decision", "rejected");

    await moderateReport(formData);

    expect(mocks.refreshClusterVisibility).toHaveBeenCalledTimes(1);
    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-old");
  });

  it("refreshes both clusters when an approved report moves", async () => {
    seedRows = {
      bug_reports: [{ id: "report-one", moderation_status: "approved", cluster_id: "cluster-old" }],
    };
    const { moderateReport } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "report-one");
    formData.set("decision", "approved");
    formData.set("cluster_id", "cluster-new");

    await moderateReport(formData);

    expect(mocks.refreshClusterVisibility).toHaveBeenCalledTimes(2);
    expect(mocks.refreshClusterVisibility).toHaveBeenNthCalledWith(1, "cluster-old");
    expect(mocks.refreshClusterVisibility).toHaveBeenNthCalledWith(2, "cluster-new");
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
  it("clears the override and its synthetic claim clock so automation can re-derive status", async () => {
    const { clearClusterFixStatusOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");

    await clearClusterFixStatusOverride(formData);

    expect(mutations).toContainEqual({
      table: "issue_clusters",
      type: "update",
      row: {
        patch: {
          admin_override: false,
          lifecycle_reason: null,
          fix_claimed_at: null,
          fix_claimed_patch_version: null,
        },
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
    formData.set("reason", "Reviewed evidence warrants temporary public visibility.");
    formData.set("confirm_override", "true");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "force_public",
      p_reason: "Reviewed evidence warrants temporary public visibility.",
    });
    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-one");
  });

  it("force_hidden removes a quiet cluster from public reads before the deeper refresh", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "force_hidden");
    formData.set("reason", "Duplicate cluster is confusing the public board.");
    formData.set("confirm_override", "true");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "force_hidden",
      p_reason: "Duplicate cluster is confusing the public board.",
    });
    expect(mocks.refreshClusterVisibility).not.toHaveBeenCalled();
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
      p_reason: null,
    });
    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-one");
  });

  it("retries the legacy visibility RPC only when the new signature is missing", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.set_cluster_visibility_override(p_cluster_id, p_reason, p_visibility) in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "auto");

    await setClusterVisibilityOverride(formData);

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "auto",
      p_reason: null,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "set_cluster_visibility_override", {
      p_cluster_id: "cluster-one",
      p_visibility: "auto",
    });
  });

  it("does not hide a real visibility RPC failure behind the legacy fallback", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "auto");

    await expect(setClusterVisibilityOverride(formData)).rejects.toThrow("permission denied");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("revalidates the applied override when the immediate refresh fails", async () => {
    mocks.refreshClusterVisibility.mockRejectedValueOnce(new Error("refresh failed"));
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "auto");

    await expect(setClusterVisibilityOverride(formData)).rejects.toThrow("refresh failed");

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-dashboard", "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-issues", "max");
  });

  it("rejects unknown visibility values", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "yeet");

    await expect(setClusterVisibilityOverride(formData)).rejects.toThrow("bad input");
    expect(mutations).toEqual([]);
  });

  it("requires a reason and explicit confirmation before forcing visibility", async () => {
    const { setClusterVisibilityOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("cluster_id", "cluster-one");
    formData.set("visibility", "force_public");

    await expect(setClusterVisibilityOverride(formData)).rejects.toThrow("override reason and confirmation required");
    expect(mocks.rpc).not.toHaveBeenCalled();
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

describe("recordScannerDecision", () => {
  beforeEach(() => {
    seedRows = {
      automation_rejected_candidates: [
        {
          id: "candidate-protonmail",
          title: "Any plans for MCP?",
          url: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp?utm_source=search",
          source_domain: "reddit.com",
          source_published_at: null,
          snippet: "A Proton product feature request unrelated to Crimson Desert.",
        },
      ],
    };
  });

  it("records a durable exact-URL rejection without changing visibility or rescuing the candidate", async () => {
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "off_topic");
    formData.set("reason", "This is from r/ProtonMail and is unrelated to the game.");
    formData.set("scope", "exact_url");

    await recordScannerDecision(formData);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_scanner_decision",
      expect.objectContaining({
        p_candidate_id: "candidate-protonmail",
        p_decision: "off_topic",
        p_scope_type: "exact_url",
        p_scope_value: "https://www.reddit.com/r/ProtonMail/comments/abc/any_plans_for_mcp",
        p_confirm_broad: false,
        p_target_url_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.rescueCandidateSignal).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_cluster_visibility_override", expect.anything());
  });

  it("requires explicit confirmation for a subreddit rule", async () => {
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "off_topic");
    formData.set("reason", "This subreddit is unrelated to Crimson Desert.");
    formData.set("scope", "source_path");

    await expect(recordScannerDecision(formData)).rejects.toThrow("bad input");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the visible subreddit scope only after broad-rule confirmation", async () => {
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "off_topic");
    formData.set("reason", "This subreddit is unrelated to Crimson Desert.");
    formData.set("scope", "source_path");
    formData.set("confirm_broad", "true");

    await recordScannerDecision(formData);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_scanner_decision",
      expect.objectContaining({
        p_scope_type: "source_path",
        p_scope_value: "reddit.com/r/protonmail",
        p_confirm_broad: true,
      }),
    );
  });

  it("rescues a Relevant candidate before recording the durable allow rule", async () => {
    mocks.rescueCandidateSignal.mockResolvedValueOnce(undefined);
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "relevant");
    formData.set("reason", "Operator verified this is a real Crimson Desert issue.");
    formData.set("scope", "exact_url");

    await recordScannerDecision(formData);

    expect(mocks.rescueCandidateSignal).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_scanner_decision",
      expect.objectContaining({ p_candidate_id: "candidate-protonmail", p_decision: "relevant" }),
    );
    expect(mocks.rescueCandidateSignal.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it("preserves the legacy rescue path before the scanner-decision RPC is deployed", async () => {
    mocks.rescueCandidateSignal.mockResolvedValueOnce(undefined);
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.record_scanner_decision in the schema cache",
      },
    });
    const { rescueRejectedCandidate } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");

    await rescueRejectedCandidate(formData);

    expect(mocks.rescueCandidateSignal).toHaveBeenCalledTimes(1);
    expect(mutations).toContainEqual({
      table: "automation_rejected_candidates",
      type: "update",
      row: {
        patch: expect.objectContaining({ rescued_at: expect.any(String) }),
        filters: [{ column: "id", value: "candidate-protonmail" }],
      },
    });
  });

  it("does not pretend a rejection was learned when the decision RPC is missing", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.record_scanner_decision in the schema cache",
      },
    });
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "off_topic");
    formData.set("reason", "This source is unrelated to Crimson Desert.");
    formData.set("scope", "exact_url");

    await expect(recordScannerDecision(formData)).rejects.toThrow("scanner decision write failed");
  });

  it("leaves the candidate and prior rules untouched when a Relevant rescue fails", async () => {
    mocks.rescueCandidateSignal.mockRejectedValueOnce(new Error("signal write failed"));
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "candidate-protonmail");
    formData.set("decision", "relevant");
    formData.set("reason", "Operator verified this is a real Crimson Desert issue.");
    formData.set("scope", "exact_url");

    await expect(recordScannerDecision(formData)).rejects.toThrow("signal write failed");

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });

  it("removes one kept lead and refreshes only its cluster after recording the exact-URL lesson", async () => {
    seedRows = {
      source_signals: [
        {
          id: "signal-pubg",
          cluster_id: "cluster-other",
          source_url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/abc/guerilla_warfare",
          canonical_url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/abc/guerilla_warfare",
          source_domain: "reddit.com",
        },
      ],
    };
    mocks.rpc.mockResolvedValueOnce({
      data: [{ decision_id: "decision-signal", rule_id: "rule-signal", affected_cluster_id: "cluster-current" }],
      error: null,
    });
    const { recordScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("id", "signal-pubg");
    formData.set("target_kind", "signal");
    formData.set("decision", "off_topic");
    formData.set("reason", "This is a PUBG post with an unrelated search snippet.");
    formData.set("scope", "exact_url");

    await recordScannerDecision(formData);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_scanner_decision",
      expect.objectContaining({
        p_candidate_id: null,
        p_signal_id: "signal-pubg",
        p_decision: "off_topic",
        p_scope_type: "exact_url",
        p_scope_value: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/abc/guerilla_warfare",
      }),
    );
    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-current");
  });

  it("does not allow a kept signal to create a Relevant or broad rule", async () => {
    const { recordScannerDecision } = await import("@/app/admin/actions");
    for (const [decision, scope] of [
      ["relevant", "exact_url"],
      ["off_topic", "source_domain"],
    ] as const) {
      const formData = new FormData();
      formData.set("id", "signal-pubg");
      formData.set("target_kind", "signal");
      formData.set("decision", decision);
      formData.set("reason", "This kept lead should be removed.");
      formData.set("scope", scope);
      formData.set("confirm_broad", "true");
      await expect(recordScannerDecision(formData)).rejects.toThrow("bad input");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("undoScannerDecision", () => {
  it("revokes the learning rule without touching cluster visibility", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ undone: true, affected_cluster_id: null }], error: null });
    const { undoScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("decision_id", "decision-one");

    await undoScannerDecision(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("undo_scanner_decision", { p_decision_id: "decision-one" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_cluster_visibility_override", expect.anything());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("recomputes the affected signal cluster after undo", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ undone: true, affected_cluster_id: "cluster-current" }],
      error: null,
    });
    const { undoScannerDecision } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("decision_id", "decision-signal");

    await undoScannerDecision(formData);

    expect(mocks.refreshClusterVisibility).toHaveBeenCalledWith("cluster-current");
    expect(mocks.from).not.toHaveBeenCalledWith("scanner_decisions");
    expect(mocks.from).not.toHaveBeenCalledWith("source_signals");
  });
});

describe("setCurrentPatchOverride", () => {
  it("rejects a malformed patch version with no writes", async () => {
    const { setCurrentPatchOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("patch_version", "not-a-version");

    await expect(setCurrentPatchOverride(formData)).rejects.toThrow("bad input");
    expect(mutations).toEqual([]);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("writes the manual current patch through one atomic RPC and refreshes public surfaces", async () => {
    const { setCurrentPatchOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("patch_version", "1.13.02");

    await setCurrentPatchOverride(formData);

    expect(mocks.rpc).toHaveBeenCalledWith("set_current_patch_override", {
      p_observed_at: expect.any(String),
      p_patch_version: "1.13.02",
    });
    expect(mutations.filter((mutation) => mutation.table === "official_patch_notes")).toEqual([]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("current-patch", "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("blocks the override in Vercel preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const { setCurrentPatchOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("patch_version", "1.13.02");

    await expect(setCurrentPatchOverride(formData)).rejects.toThrow("preview writes disabled");
    expect(mutations).toEqual([]);
  });

  it("surfaces an atomic write failure instead of claiming success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "manual patch write failed" } });
    const { setCurrentPatchOverride } = await import("@/app/admin/actions");
    const formData = new FormData();
    formData.set("patch_version", "1.13.02");

    await expect(setCurrentPatchOverride(formData)).rejects.toThrow("manual patch write failed");
    expect(mutations.filter((mutation) => mutation.table === "official_patch_notes")).toEqual([]);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
