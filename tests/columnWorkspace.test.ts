import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/operator/column-actions", () => ({
  approveEdition: vi.fn(), setColumnPaused: vi.fn(), vetoEdition: vi.fn(),
  saveColumnCadence: vi.fn(), saveColumnBurst: vi.fn(), deleteColumnBurst: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: ComponentProps<"a">) => createElement("a", { ...props, href }, children) }));

import { ColumnWorkspace } from "@/components/operator/ColumnWorkspace";
import { DEFAULT_COLUMN_SETTINGS } from "@/lib/editorials/settings";
import type { AdminEditionRow, ColumnDashboard } from "@/lib/editorials/store.server";
import { NOW } from "./editorialFixtures";

function row(overrides: Partial<AdminEditionRow>): AdminEditionRow {
  return {
    id: "e0000000-0000-4000-8000-000000000001", slot_key: "2026-W44:s0", is_test: false, slug: "an-edition", status: "held",
    title: "An edition", dek: null, body_md: "## The forecast\n\nClear skies.", facts_box: null, relevance_score: 3,
    writer_model: "claude-opus-5-5", writer_effort: "high", skip_reason: null, hold_hours: 24,
    created_at: "2026-10-26T14:00:00Z", updated_at: "2026-10-26T14:00:00Z", publish_at: null, published_at: null, vetoed_at: null, ...overrides,
  };
}

function render(dashboard: ColumnDashboard | null, writesDisabled = false, keys = { anthropic: true, openrouter: false }) {
  return renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard, draft: null, notice: null, now: NOW, writesDisabled, keys }));
}

const ready = (overrides: Partial<Extract<ColumnDashboard, { state: "ready" }>> = {}): ColumnDashboard => ({
  state: "ready", settings: DEFAULT_COLUMN_SETTINGS, settingsUpdatedAt: null, recent: [], pending: [],
  spend: { month: "2026-10", spentUsd: 0.42, capUsd: 15 }, ...overrides,
});

describe("the Column card", () => {
  it("still loads when the column tables are not set up", () => {
    const html = render({ state: "not_set_up", settings: DEFAULT_COLUMN_SETTINGS });
    expect(html).toContain("Not set up yet");
    expect(html).not.toContain("Pause the column");
  });

  it("shows an unavailable read as unavailable, never as an empty column", () => {
    const html = render(null);
    expect(html).toContain("Column record unavailable");
    expect(html).not.toContain("No editions yet");
  });

  it("shows the approve-first count, spend and the approve button for a waiting edition", () => {
    const html = render(ready({ pending: [row({})], recent: [row({}), row({ id: "skip", status: "skipped", title: null, slug: null, skip_reason: "provider_unavailable", slot_key: "2026-W43:s0" })] }));
    expect(html).toContain("Approve-first: 3 editions left.");
    expect(html).toContain("$0.42 of $15.00");
    expect(html).toContain("Approve and publish");
    expect(html).toContain("Skipped: Provider unavailable");
    expect(html).toContain("Pause the column");
  });

  it("offers veto, not approval, for an edition on the 24-hour hold, with its countdown", () => {
    const settings = { ...DEFAULT_COLUMN_SETTINGS, approveFirstRemaining: 0 };
    const html = render(ready({ settings, pending: [row({ publish_at: "2026-10-27T14:00:00Z" })] }));
    expect(html).toContain("Approve-first is done. New editions publish after a 24-hour hold unless you veto them.");
    expect(html).toContain("Publishes Oct 27, 14:00 UTC");
    expect(html).toContain("in 23h 0m");
    expect(html).not.toContain("Approve and publish");
    expect(html).toContain(">Veto<");
  });

  it("shows Resume when paused and disables every action on preview builds", () => {
    const html = render(ready({ settings: { ...DEFAULT_COLUMN_SETTINGS, paused: true }, pending: [row({})] }), true);
    expect(html).toContain("Resume the column");
    expect(html).toContain("column changes are disabled here");
    expect(html.match(/<button[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
