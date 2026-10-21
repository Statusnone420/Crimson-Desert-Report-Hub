import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), live: vi.fn(), dashboard: vi.fn(), settings: vi.fn(), auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/page", () => ({ default: () => null }));
vi.mock("@/app/scanner/page", () => ({ default: () => null }));
vi.mock("@/app/admin/videos/page", () => ({ default: () => null }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/previewGuard", () => ({ isAiSettingsPreviewAllowed: mocks.preview, isAiSettingsLiveAllowed: mocks.live }));
vi.mock("@/lib/aiSettings/store.server", () => ({ readAiDashboard: mocks.dashboard }));
vi.mock("@/lib/scannerSettings.server", () => ({ readScannerSettings: mocks.settings }));
import OperatorPage from "@/app/operator/page";

describe("one private settings destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockReturnValue(false);
    mocks.live.mockReturnValue(true);
    mocks.dashboard.mockResolvedValue(null);
    mocks.settings.mockResolvedValue({ control: { minIntervalMinutes: 120 }, tavilyUsage: { state: "unavailable" } });
  });

  it("loads the saved schedule alongside AI settings after authentication", async () => {
    const page = await OperatorPage({ searchParams: Promise.resolve({ view: "ai" }) });
    expect(mocks.auth).toHaveBeenCalledWith("/operator?view=ai");
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.settings.mock.invocationCallOrder[0]);
    expect(page.props.children.props.scannerSettings.props.control).toEqual({ minIntervalMinutes: 120 });
  });

  it("keeps a failed schedule read visible without disabling the AI settings page", async () => {
    mocks.settings.mockRejectedValue(new Error("settings read failed"));
    const page = await OperatorPage({ searchParams: Promise.resolve({ view: "ai" }) });
    expect(page.props.children.props.scannerSettings.props).toEqual({ control: null, tavilyUsage: { state: "unavailable" } });
  });

  it("does not read live settings for the design preview", async () => {
    mocks.preview.mockReturnValue(true);
    await OperatorPage({ searchParams: Promise.resolve({ view: "ai" }) });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
