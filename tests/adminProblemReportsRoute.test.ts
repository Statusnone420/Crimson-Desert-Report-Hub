import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), preview: vi.fn(), list: vi.fn(), read: vi.fn(), update: vi.fn(), client: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.admin }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.preview }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: mocks.client, hasSupabaseServiceConfig: mocks.configured }));
vi.mock("@/lib/problemReports.server", async (original) => ({ ...await original<typeof import("@/lib/problemReports.server")>(), listProblemReports: mocks.list, readProblemReport: mocks.read, updateProblemReport: mocks.update }));
import { GET as list } from "@/app/api/admin/problem-reports/route";
import { GET as read, PATCH } from "@/app/api/admin/problem-reports/[id]/route";

const origin = "https://crimsonreporthub.com";
const id = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
const getRequest = new Request(`${origin}/api/admin/problem-reports`);
function patch(body: unknown = { revision: 0, status: "approved", note: "Verified creator control" }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/admin/problem-reports/${id}`, { method: "PATCH", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.admin.mockResolvedValue(true); mocks.preview.mockReturnValue(false); mocks.configured.mockReturnValue(true); mocks.client.mockReturnValue("private-client");
  mocks.list.mockResolvedValue({ reports: [], nextOffset: null }); mocks.read.mockResolvedValue({ id, status: "new", email: "creator@example.test" }); mocks.update.mockResolvedValue({ outcome: "updated", revision: 1, updated_at: "2026-10-16T12:00:00Z" });
});

describe("authenticated agent reports API", () => {
  it("rejects anonymous listing, reading, and updates before database access", async () => {
    mocks.admin.mockResolvedValue(false);
    for (const response of [await list(getRequest), await read(getRequest, context), await PATCH(patch(), context)]) { expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthorized" }); expect(response.headers.get("cache-control")).toContain("no-store"); }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("lists with bounded pagination/filter and reads a private report", async () => {
    expect((await list(new Request(`${getRequest.url}?status=new&offset=50`))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("private-client", { status: "new", offset: 50 });
    const response = await read(getRequest, context); expect(await response.json()).toMatchObject({ report: { id, email: "creator@example.test" } });
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await list(new Request(`${getRequest.url}?offset=-1`))).status).toBe(400);
    expect((await list(new Request(`${getRequest.url}?status=published`))).status).toBe(400);
  });
  it("updates only review status and appends a private note with optimistic concurrency", async () => {
    const response = await PATCH(patch(), context); expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("private-client", id, 0, "approved", "Verified creator control");
    expect((await PATCH(patch({ revision: 0, description: "rewrite content" }), context)).status).toBe(400);
  });
  it("rejects cross-site updates and preview writes", async () => {
    expect((await PATCH(patch(undefined, { origin: "https://other.test" }), context)).status).toBe(403);
    mocks.preview.mockReturnValue(true); expect((await PATCH(patch(), context)).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reports conflicts, missing rows, and read failures explicitly", async () => {
    mocks.update.mockResolvedValue({ outcome: "conflict" }); expect((await PATCH(patch(), context)).status).toBe(409);
    mocks.read.mockResolvedValue(null); expect((await read(getRequest, context)).status).toBe(404);
    mocks.list.mockRejectedValue(new Error("private database details")); const response = await list(getRequest); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "read_failed" });
  });
});
