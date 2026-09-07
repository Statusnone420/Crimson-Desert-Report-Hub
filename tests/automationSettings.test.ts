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
  it("defaults to fifty cents and caps stored policy and form input at one dollar", async () => {
    const { getAutomationControlState, scannerPolicyFromFormData } = await import("@/lib/automation/settings");
    const formData = new FormData();
    formData.set("monthlyLlmUsdCap", "5");

    await expect(getAutomationControlState(fakeSupabase([]))).resolves.toMatchObject({ monthlyLlmUsdCap: 0.5 });
    await expect(
      getAutomationControlState(fakeSupabase([{ key: "scanner", value: { monthlyLlmUsdCap: 5 } }])),
    ).resolves.toMatchObject({ monthlyLlmUsdCap: 1 });
    expect(scannerPolicyFromFormData(formData)).toMatchObject({ monthlyLlmUsdCap: 1 });
    await expect(
      getAutomationControlState(fakeSupabase([{ key: "scanner", value: { monthlyLlmUsdCap: 2 } }])),
    ).resolves.toMatchObject({ monthlyLlmUsdCap: 1 });
  });

  it("preserves approved saved routes and defaults unknown routes to standard Luna", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(
      getAutomationControlState(fakeSupabase([{ key: "scanner", value: { modelPreset: "deepseek_qwen_pro" } }])),
    ).resolves.toMatchObject({ modelPreset: "gpt_5_6_luna" });

    await expect(
      getAutomationControlState(fakeSupabase([{ key: "scanner", value: { modelPreset: "deepseek_v4_flash" } }])),
    ).resolves.toMatchObject({ modelPreset: "gpt_5_6_luna" });
    await expect(
      getAutomationControlState(fakeSupabase([{ key: "scanner", value: { modelPreset: "gpt_5_6_luna_flex" } }])),
    ).resolves.toMatchObject({ modelPreset: "gpt_5_6_luna_flex" });
  });

  it("keeps legacy stored DeepSeek values on Luna without rewriting the row", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");
    const { resolveAutomationOpenRouterModel } = await import("@/lib/automation/budget");
    const rows: Row[] = [{ key: "scanner", value: { paused: true, modelPreset: "deepseek_v4_flash", monthlyLlmUsdCap: 0.5 } }];
    const before = structuredClone(rows);
    const policy = await getAutomationControlState(fakeSupabase(rows));
    expect(policy).toMatchObject({ paused: true, modelPreset: "gpt_5_6_luna", monthlyLlmUsdCap: 0.5 });
    expect(resolveAutomationOpenRouterModel("deepseek/deepseek-v4-flash", policy.modelPreset)).toBe("openai/gpt-5.6-luna");
    expect(rows).toEqual(before);
  });

  it("round-trips a new explicit rollback choice through form, storage and pause changes", async () => {
    const { scannerPolicyFromFormData, setScannerPolicy, getAutomationControlState, setAutomationPaused } = await import("@/lib/automation/settings");
    const { resolveAutomationOpenRouterModel, automationModelSettings } = await import("@/lib/automation/budget");
    const form = new FormData();
    form.set("modelPreset", "deepseek_v4_flash_rollback");
    form.set("monthlyLlmUsdCap", "0.5");
    const rows: Row[] = [];
    const client = fakeSupabase(rows);
    await setScannerPolicy(client, scannerPolicyFromFormData(form));
    await setAutomationPaused(client, true);
    const policy = await getAutomationControlState(client);
    expect(policy).toMatchObject({ modelPreset: "deepseek_v4_flash_rollback", paused: true, monthlyLlmUsdCap: 0.5 });
    const model = resolveAutomationOpenRouterModel("openai/gpt-5.6-luna", policy.modelPreset);
    expect(model).toBe("deepseek/deepseek-v4-flash");
    expect(automationModelSettings(model, policy.modelPreset).provider).toMatchObject({ data_collection: "deny", zdr: true });
  });

  it("defaults to the safe scanner policy when no scanner setting exists", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(getAutomationControlState(fakeSupabase([]))).resolves.toEqual({
      paused: false,
      minIntervalMinutes: 60,
      scheduledSearchCreditsPerRun: 1,
      monthlyTavilyCreditCap: 1000,
      monthlyLlmUsdCap: 0.5,
      modelPreset: "gpt_5_6_luna",
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
      monthlyTavilyCreditCap: 1000,
      monthlyLlmUsdCap: 0.5,
      modelPreset: "gpt_5_6_luna",
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
      monthlyTavilyCreditCap: 1000,
      monthlyLlmUsdCap: 1,
      modelPreset: "gpt_5_6_luna",
    });
  });

  it("caps stored Tavily credits to the free-tier scanner guardrail", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(
      getAutomationControlState(
        fakeSupabase([{ key: "scanner", value: { monthlyTavilyCreditCap: 4000 } }]),
      ),
    ).resolves.toMatchObject({
      monthlyTavilyCreditCap: 1000,
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
          modelPreset: "deepseek_v4_flash",
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
        monthlyLlmUsdCap: 1,
        modelPreset: "gpt_5_6_luna",
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
    formData.set("modelPreset", "deepseek_v4_flash");

    expect(scannerPolicyFromFormData(formData)).toEqual({
      paused: true,
      minIntervalMinutes: 360,
      scheduledSearchCreditsPerRun: 2,
      monthlyTavilyCreditCap: 900,
      monthlyLlmUsdCap: 1,
      modelPreset: "gpt_5_6_luna",
    });

    formData.set("cadence", "120");

    expect(scannerPolicyFromFormData(formData)).toMatchObject({
      paused: false,
      minIntervalMinutes: 120,
    });
  });
});
