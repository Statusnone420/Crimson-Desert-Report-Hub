import { describe, expect, it, vi } from "vitest";
import type { AutomationSettingsClient } from "@/lib/automation/settings";

vi.mock("server-only", () => ({}));

type Row = { key: string; value: unknown; updated_at?: string | null };

class FakeQuery {
  private filter: { column: string; value: unknown } | null = null;
  private upsertRow: Row | null = null;

  constructor(private rows: Row[]) {}

  select() {
    return this;
  }

  upsert(row: Row) {
    this.upsertRow = row;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filter = { column, value };
    return this;
  }

  limit() {
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
      const existing = this.rows.find((row) => row.key === this.upsertRow!.key);
      if (existing) Object.assign(existing, this.upsertRow);
      else this.rows.push(this.upsertRow);
      return { data: [this.upsertRow], error: null };
    }

    return {
      data: this.filter ? this.rows.filter((row) => row[this.filter!.column as keyof Row] === this.filter!.value) : this.rows,
      error: null,
    };
  }
}

function fakeSupabase(rows: Row[]): AutomationSettingsClient {
  return {
    from: () => new FakeQuery(rows),
  } as unknown as AutomationSettingsClient;
}

describe("automation scanner settings", () => {
  it("defaults to the safe scanner policy when no scanner setting exists", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(getAutomationControlState(fakeSupabase([]))).resolves.toEqual({
      paused: false,
      minIntervalMinutes: 60,
      scheduledSearchCreditsPerRun: 1,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 1,
      modelPreset: "deepseek_qwen_pro",
      updatedAt: null,
    });
  });

  it("hydrates legacy paused-only scanner settings with policy defaults", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(
      getAutomationControlState(
        fakeSupabase([{ key: "scanner", value: { paused: true }, updated_at: "2026-07-06T12:00:00.000Z" }]),
      ),
    ).resolves.toEqual({
      paused: true,
      minIntervalMinutes: 60,
      scheduledSearchCreditsPerRun: 1,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 1,
      modelPreset: "deepseek_qwen_pro",
      updatedAt: "2026-07-06T12:00:00.000Z",
    });
  });

  it("clamps invalid stored scanner settings to safe values", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(
      getAutomationControlState(
        fakeSupabase([
          {
            key: "scanner",
            value: {
              paused: "yes",
              minIntervalMinutes: 90,
              scheduledSearchCreditsPerRun: 5,
              monthlyTavilyCreditCap: -10,
              monthlyLlmUsdCap: 9,
              modelPreset: "other-model",
            },
          },
        ]),
      ),
    ).resolves.toMatchObject({
      paused: false,
      minIntervalMinutes: 60,
      scheduledSearchCreditsPerRun: 1,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 5,
      modelPreset: "deepseek_qwen_pro",
    });
  });

  it("caps stored Tavily credits to the free-tier scanner guardrail", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(
      getAutomationControlState(
        fakeSupabase([{ key: "scanner", value: { monthlyTavilyCreditCap: 4000 } }]),
      ),
    ).resolves.toMatchObject({
      monthlyTavilyCreditCap: 900,
    });
  });

  it("reads and writes the scanner paused state without dropping policy fields", async () => {
    const { getAutomationControlState, setAutomationPaused } = await import("@/lib/automation/settings");
    const rows: Row[] = [
      {
        key: "scanner",
        value: {
          paused: false,
          minIntervalMinutes: 120,
          scheduledSearchCreditsPerRun: 3,
          monthlyTavilyCreditCap: 100,
          monthlyLlmUsdCap: 4,
          modelPreset: "deepseek_qwen_pro",
        },
      },
    ];
    const supabase = fakeSupabase(rows);

    await setAutomationPaused(supabase, true);

    expect(rows[0]).toMatchObject({
      key: "scanner",
      value: {
        paused: true,
        minIntervalMinutes: 120,
        scheduledSearchCreditsPerRun: 3,
        monthlyTavilyCreditCap: 100,
        monthlyLlmUsdCap: 4,
        modelPreset: "deepseek_qwen_pro",
      },
    });
    await expect(getAutomationControlState(supabase)).resolves.toMatchObject({ paused: true });
  });

  it("parses the admin cadence control including paused", async () => {
    const { scannerPolicyFromFormData } = await import("@/lib/automation/settings");
    const formData = new FormData();
    formData.set("cadence", "paused");
    formData.set("minIntervalMinutes", "360");
    formData.set("scheduledSearchCreditsPerRun", "2");
    formData.set("monthlyTavilyCreditCap", "900");
    formData.set("monthlyLlmUsdCap", "3");
    formData.set("modelPreset", "deepseek_qwen_pro");

    expect(scannerPolicyFromFormData(formData)).toEqual({
      paused: true,
      minIntervalMinutes: 360,
      scheduledSearchCreditsPerRun: 2,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 3,
      modelPreset: "deepseek_qwen_pro",
    });

    formData.set("cadence", "120");

    expect(scannerPolicyFromFormData(formData)).toMatchObject({
      paused: false,
      minIntervalMinutes: 120,
    });
  });
});
