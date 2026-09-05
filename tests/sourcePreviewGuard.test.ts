import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), isPreview: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/preview", () => ({ previewAutomationSearch: mocks.preview }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.isPreview }));
import { GET } from "@/app/api/cron/source-preview/route";
beforeEach(() => { vi.stubEnv("CRON_SECRET", "fixture-secret"); mocks.preview.mockReset().mockResolvedValue({}); mocks.isPreview.mockReturnValue(true); });
afterEach(() => vi.unstubAllEnvs());
it("blocks paid source discovery in Vercel Preview before calling the provider", async () => {
  const response = await GET(new Request("https://example.com/api/cron/source-preview", { headers: { authorization: "Bearer fixture-secret" } }));
  expect(response.status).toBe(403);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it("keeps the authenticated capped production diagnostic available", async () => {
  mocks.isPreview.mockReturnValue(false);
  const response = await GET(new Request("https://example.com/api/cron/source-preview?queries=5", { headers: { authorization: "Bearer fixture-secret" } }));
  expect(response.status).toBe(200);
  expect(mocks.preview).toHaveBeenCalledWith({ maxQueries: 2 });
});
