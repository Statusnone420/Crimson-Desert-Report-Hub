import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ control: vi.fn(), spend: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.control }));
vi.mock("@/lib/automation/budgetState.server", () => ({ loadMonthSpend: mocks.spend }));
import { readScannerSettings } from "@/lib/scannerSettings.server";

describe("private scanner settings read", () => {
  beforeEach(() => {
    mocks.control.mockReset().mockResolvedValue({ minIntervalMinutes: 120, monthlyTavilyCreditCap: 1000 });
    mocks.spend.mockReset().mockResolvedValue({ tavilyCredits: 40 });
  });

  it("keeps saved controls distinct from usage and its monthly pace", async () => {
    expect(await readScannerSettings(new Date("2026-10-05T00:00:00Z"))).toMatchObject({
      control: { minIntervalMinutes: 120, monthlyTavilyCreditCap: 1000 },
      tavilyUsage: { state: "available", used: 40, pace: 310 },
    });
    expect((await readScannerSettings(new Date("2026-10-01T12:00:00Z"))).tavilyUsage).toMatchObject({ pace: null });
  });

  it("marks a failed usage read unavailable without losing the saved settings", async () => {
    mocks.spend.mockRejectedValue(new Error("ledger unavailable"));
    expect(await readScannerSettings()).toMatchObject({ control: { minIntervalMinutes: 120 }, tavilyUsage: { state: "unavailable" } });
  });

  it("does not substitute defaults when settings cannot be read", async () => {
    mocks.control.mockRejectedValue(new Error("permission denied"));
    expect((await readScannerSettings()).control).toBeNull();
  });
});
