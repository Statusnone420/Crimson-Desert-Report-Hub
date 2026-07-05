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
  it("defaults to active when no scanner setting exists", async () => {
    const { getAutomationControlState } = await import("@/lib/automation/settings");

    await expect(getAutomationControlState(fakeSupabase([]))).resolves.toEqual({
      paused: false,
      updatedAt: null,
    });
  });

  it("reads and writes the scanner paused state", async () => {
    const { getAutomationControlState, setAutomationPaused } = await import("@/lib/automation/settings");
    const rows: Row[] = [];
    const supabase = fakeSupabase(rows);

    await setAutomationPaused(supabase, true);

    expect(rows[0]).toMatchObject({
      key: "scanner",
      value: { paused: true },
    });
    await expect(getAutomationControlState(supabase)).resolves.toMatchObject({ paused: true });
  });
});
