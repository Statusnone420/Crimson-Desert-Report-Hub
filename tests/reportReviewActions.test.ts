import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_REPORT_REVIEW_STATE } from "@/lib/reportReviewAction";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), guard: vi.fn(), moderate: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/previewGuard", () => ({ assertProductionWriteAllowed: mocks.guard }));
vi.mock("@/app/admin/actions", () => ({ moderateReport: mocks.moderate }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/revalidate", () => ({ revalidatePublicSurfaces: mocks.revalidate }));
import { reviewReport, retryApprovedExcerpt } from "@/app/admin/report-actions";

function form() {
  const data = new FormData();
  data.set("id", "99000000-0000-4000-8000-000000000001");
  data.set("decision", "approved");
  data.set("excerpt", "A factual excerpt.");
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(undefined);
  mocks.moderate.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("recoverable report decisions", () => {
  it("requires a still-pending report for every workspace decision", async () => {
    const data = form();
    expect((await reviewReport(INITIAL_REPORT_REVIEW_STATE, data)).status).toBe("saved");
    expect(mocks.moderate).toHaveBeenCalledWith(data);
    expect(data.get("expected_status")).toBe("pending");
  });

  it("records partial approval and retries only the excerpt", async () => {
    mocks.moderate.mockRejectedValueOnce(new Error("approved excerpt insert failed: offline"));
    const data = form();
    const partial = await reviewReport(INITIAL_REPORT_REVIEW_STATE, data);
    expect(partial.status).toBe("approved_excerpt_pending");
    expect(data.get("excerpt")).toBe("A factual excerpt.");
    expect((await retryApprovedExcerpt(partial, data)).status).toBe("saved");
    expect(mocks.moderate).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_approved_report_excerpt", {
      p_report_id: data.get("id"), p_excerpt: "A factual excerpt.",
    });
  });

  it("keeps the partial outcome when safe retry is not deployed", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Could not find the function public.save_approved_report_excerpt(p_excerpt, p_report_id) in the schema cache" } });
    const result = await retryApprovedExcerpt(INITIAL_REPORT_REVIEW_STATE, form());
    expect(result.status).toBe("approved_excerpt_pending");
    expect(result.message).toContain("database update");
    expect(mocks.moderate).not.toHaveBeenCalled();
  });

  it("preserves the stale decision message without writing another result", async () => {
    mocks.moderate.mockRejectedValue(new Error("stale report decision"));
    const result = await reviewReport(INITIAL_REPORT_REVIEW_STATE, form());
    expect(result.status).toBe("stale");
    expect(result.message).toContain("already decided elsewhere");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([reviewReport, retryApprovedExcerpt])("propagates auth and preview refusal before any write", async (action) => {
    mocks.auth.mockRejectedValueOnce(new Error("auth sentinel"));
    await expect(action(INITIAL_REPORT_REVIEW_STATE, form())).rejects.toThrow("auth sentinel");
    mocks.guard.mockImplementationOnce(() => { throw new Error("preview writes disabled"); });
    await expect(action(INITIAL_REPORT_REVIEW_STATE, form())).rejects.toThrow("preview writes disabled");
    expect(mocks.moderate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not convert an unexpected programming error or redirect into a retry", async () => {
    mocks.moderate.mockRejectedValueOnce(new TypeError("implementation sentinel"));
    await expect(reviewReport(INITIAL_REPORT_REVIEW_STATE, form())).rejects.toThrow("implementation sentinel");
    mocks.moderate.mockRejectedValueOnce(Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/admin/login" }));
    await expect(reviewReport(INITIAL_REPORT_REVIEW_STATE, form())).rejects.toThrow("redirect");
  });
});
