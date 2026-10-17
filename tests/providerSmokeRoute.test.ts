import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.admin }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.preview }));
import { POST } from "@/app/api/admin/scan/provider-smoke/route";
beforeEach(() => { mocks.admin.mockReset().mockResolvedValue(true); mocks.preview.mockReset().mockReturnValue(true); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("provider diagnostic spending boundary", () => {
  it("requires an admin session first", async () => {
    mocks.admin.mockResolvedValue(false);
    expect((await POST()).status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("keeps the production route unavailable", async () => {
    mocks.preview.mockReturnValue(false);
    expect((await POST()).status).toBe(404);
  });
  it.each(["", "fixture-key", "expired-key", "unverified-key"])("cannot dispatch with a configured key: %s", async (key) => {
    vi.stubEnv("OPENROUTER_API_KEY", key);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await POST();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "paid_diagnostics_disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
