import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/operator/column-actions", () => ({
  approveEdition: vi.fn(), setColumnPaused: vi.fn(), vetoEdition: vi.fn(),
  saveColumnCadence: vi.fn(), saveColumnBurst: vi.fn(), deleteColumnBurst: vi.fn(),
  saveStyleNote: vi.fn(), saveVoiceExampleAction: vi.fn(), deleteVoiceExampleAction: vi.fn(), moveVoiceExampleAction: vi.fn(), generateTestDraftAction: vi.fn(),
  publishTestDraft: vi.fn(),
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
    writer_model: "claude-opus-5-5", writer_effort: "high", skip_reason: null, check_note: null, hold_hours: 24,
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

  it("says what stopped a checker that never judged the draft, instead of a failed fact check", () => {
    const skip = (id: string, skip_reason: string, check_note: string | null, body_md: string | null = null) =>
      row({ id, status: "skipped", title: null, slug: null, body_md, skip_reason, check_note, slot_key: `2026-W43:${id}` });
    const html = render(ready({ recent: [
      skip("cut", "check_failed", "max_tokens", "## The forecast\n\nUnchecked."),
      skip("late", "check_failed", "checker_out_of_time"),
      skip("facts", "check_failed", null),
      skip("writer", "writer_failed", "max_tokens"),
    ] }));
    expect(html).toContain("Skipped: Checker hit its token limit");
    expect(html).toContain("Skipped: No time left for the fact check");
    expect(html.match(/Skipped: Fact check failed/g)).toHaveLength(1);
    expect(html).toContain("Skipped: Writer failed");
    // Only the skip that kept a draft links to it.
    expect(html).toContain('href="/operator?view=column&amp;edition=cut"');
    for (const id of ["late", "facts", "writer"]) expect(html).not.toContain(`edition=${id}"`);
  });

  it("shows a kept draft as skipped and unchecked, with no rating form", () => {
    const draft = row({ status: "skipped", slug: null, skip_reason: "check_failed", check_note: "max_tokens", title: "Unchecked title", dek: "Unchecked dek." });
    const html = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(html).toContain('<span class="workspace-badge">Skipped</span>');
    expect(html).toContain("Skipped: Checker hit its token limit. This is the writer&#x27;s draft. Nothing in it was fact-checked, and a skipped edition never publishes.");
    expect(html).toContain("Clear skies.");
    expect(html).not.toContain("Rate this edition");
    expect(html).not.toContain("check_failed");
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

  it("shows voice examples, the rotation and the test drafts left today", () => {
    const studio = {
      examples: [{ id: "v1", body: "Deadpan weather.", label: "Weather", position: 0 }],
      rotation: [{ id: "a", title: "Clear skies" }],
      tests: [
        row({ id: "t1", is_test: true, writer_model: "claude-fable-5-1", title: "Try" }),
        row({ id: "t2", is_test: true, status: "skipped", skip_reason: "check_failed", check_note: "max_tokens", title: "Cut off" }),
        row({ id: "t3", is_test: true, status: "skipped", skip_reason: "provider_unavailable", title: null }),
      ],
      testsToday: 3,
    };
    const html = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft: null, studio, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(html).toContain("Weather");
    expect(html).toContain("The writer also reads your thumbs-up drafts and editions as voice examples, two at most: Clear skies.");
    // Test drafts can now go live, but only through the publish panel on an approved draft's page.
    expect(html).toContain("Test drafts stay private unless you publish an approved one as this week&#x27;s edition from its page.");
    expect(html).not.toContain("never take a slot");
    expect(html).toContain("7 of 10 left today (UTC)");
    const none = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft: null, studio: { ...studio, rotation: [] }, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(none).toContain("No thumbs-up drafts or editions yet. Give one a thumbs up and the writer reads it as a voice example, two at most.");
    // With no saved examples, the page only says the writer has nothing to read when thumbs-up drafts are missing too.
    const rotationOnly = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft: null, studio: { ...studio, examples: [] }, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(rotationOnly).toContain("No voice examples saved here yet.");
    expect(rotationOnly).not.toContain("style guide alone");
    expect(rotationOnly).toContain("The writer also reads your thumbs-up drafts and editions as voice examples, two at most: Clear skies.");
    const empty = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft: null, studio: { ...studio, examples: [], rotation: [] }, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(empty).toContain("No voice examples yet. The writer follows the style guide alone until you add some.");
    expect(html).toContain("TEST · Try");
    expect(html).toContain("Fable 5.1");
    // A skipped test draft reads its kept text but can't be rated, and says why it skipped in words.
    expect(html).toContain('edition=t1">Read and rate</a>');
    expect(html).toContain('edition=t2">Read</a>');
    expect(html).toContain("Skipped: Checker hit its token limit");
    expect(html).toContain("Skipped: Provider unavailable");
    expect(html).not.toContain("edition=t3");
  });

  it("offers thumbs and a note under a draft, with its earlier notes", () => {
    const notes = [{ id: "n1", rating: "down" as const, note: "Less weather.", created_at: "2026-10-26T12:00:00Z" }];
    const html = renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready(), draft: row({}), draftNotes: notes, notice: null, now: NOW, writesDisabled: false, keys: { anthropic: true, openrouter: false } }));
    expect(html).toContain("Rate this edition");
    expect(html).toContain("Thumbs down</strong> · Oct 26, 12:00 UTC");
    expect(html).toContain("0 of 500 characters");
  });

  describe("publishing a test draft", () => {
    // NOW is Monday Oct 26, 15:00 UTC: the default 14:00 slot 2026-W44:mon has started.
    const testDraft = row({ id: "e0000000-0000-4000-8000-0000000000aa", slot_key: "test:2026-10-26", is_test: true, slug: "approved-draft", title: "Approved draft" });
    const skip = row({ id: "skip", slot_key: "2026-W44:mon", status: "skipped", title: null, slug: null, body_md: null, skip_reason: "check_failed", check_note: "max_tokens" });
    const up = [{ id: "n1", rating: "up" as const, note: "Approved shape.", created_at: "2026-10-26T14:30:00Z" }];
    const draftView = (draft: AdminEditionRow, draftNotes: { id: string; rating: "up" | "down" | null; note: string | null; created_at: string }[] | null, recent: AdminEditionRow[] = [skip], writesDisabled = false) =>
      renderToStaticMarkup(createElement(ColumnWorkspace, { dashboard: ready({ recent }), draft, draftNotes, notice: null, now: NOW, writesDisabled, keys: { anthropic: true, openrouter: false } }));

    it("offers an approved test draft in place of this week's skip, behind a confirm tick", () => {
      const html = draftView(testDraft, up);
      expect(html).toContain("Publish as this week&#x27;s edition");
      expect(html).toContain("Publishes this draft now as the edition for slot 2026-W44:mon, in place of its skip (Checker hit its token limit).");
      expect(html).toContain('name="slotKey" value="2026-W44:mon"');
      expect(html).toContain('<input type="checkbox" required="" name="confirm" value="yes"/>');
      expect(html).toContain("Publish this draft");
    });

    it("asks for a thumbs up first, and leaves unread notes to the database", () => {
      expect(draftView(testDraft, [{ ...up[0], rating: "down" }])).toContain("Give this draft a thumbs up first.");
      expect(draftView(testDraft, [])).not.toContain("Publish this draft");
      expect(draftView(testDraft, null)).toContain("Publish this draft");
    });

    it("counts only the newest thumbs, so a later thumbs down withdraws an approval", () => {
      // Notes arrive newest first.
      const down = { id: "n2", rating: "down" as const, note: "On second thought, no.", created_at: "2026-10-26T14:45:00Z" };
      const plain = { id: "n3", rating: null, note: "Keep this voice.", created_at: "2026-10-26T14:50:00Z" };
      expect(draftView(testDraft, [down, ...up])).toContain("Give this draft a thumbs up first.");
      expect(draftView(testDraft, [down, ...up])).not.toContain("Publish this draft");
      expect(draftView(testDraft, [{ ...up[0], id: "n4", created_at: "2026-10-26T14:55:00Z" }, down, ...up])).toContain("Publish this draft");
      expect(draftView(testDraft, [plain, ...up])).toContain("Publish this draft");
      expect(draftView(testDraft, [plain])).not.toContain("Publish this draft");
    });

    it("says when this week's slot already has an edition, and offers nothing for drafts that can't go live", () => {
      const taken = row({ id: "taken", slot_key: "2026-W44:mon", status: "published", publish_at: "2026-10-26T14:10:00Z" });
      expect(draftView(testDraft, up, [taken])).toContain("This week&#x27;s slot (2026-W44:mon) already has an edition.");
      expect(draftView(row({ ...testDraft, status: "skipped", skip_reason: "check_failed", title: null, slug: null, body_md: null }), up)).not.toContain("Publish as this week");
      expect(draftView(row({}), up)).not.toContain("Publish as this week");
    });

    it("disables the button on preview builds", () => {
      expect(draftView(testDraft, up, [skip], true)).toMatch(/<button type="submit" class="workspace-button workspace-button--primary" disabled="">Publish this draft<\/button>/);
    });

    it("links a live edition to its public page", () => {
      const live = row({ status: "published", slug: "approved-draft", publish_at: "2026-10-26T14:30:00Z" });
      expect(draftView(live, up)).toContain('href="/editorials/approved-draft"');
      expect(draftView(row({}), up)).not.toContain("View on the site");
    });

    it("keeps Unpublish on a live edition's own page, even when the card no longer lists it", () => {
      // A published draft keeps its old created_at, so it can sit below the card's newest five.
      const live = row({ id: "e0000000-0000-4000-8000-0000000000aa", status: "published", slug: "approved-draft", publish_at: "2026-10-26T14:30:00Z" });
      const page = draftView(live, up, []);
      expect(page).toContain(">Unpublish</button>");
      expect(page).toContain('name="id" value="e0000000-0000-4000-8000-0000000000aa"');
      expect(draftView(row({ publish_at: null }), up, [])).toContain(">Veto</button>");
      expect(draftView(testDraft, up, [])).not.toMatch(/>(Veto|Unpublish)<\/button>/);
      expect(draftView(row({ status: "vetoed", vetoed_at: "2026-10-26T14:40:00Z" }), up, [])).not.toMatch(/>(Veto|Unpublish)<\/button>/);
    });
  });

  it("keeps an off-list model or provider selected as Keep, so saving the schedule never unlocks it", () => {
    const html = render(ready({ settings: { ...DEFAULT_COLUMN_SETTINGS, defaultWriterModel: "gpt-5", provider: "elsewhere" } }));
    expect(html).toContain('<option value="keep" selected="">Keep gpt-5 (not allowed: slots skip)</option>');
    expect(html).toContain('<option value="keep" selected="">Keep &quot;elsewhere&quot; (not recognized: slots skip)</option>');
  });
});
