import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEditionRow } from "@/lib/editorials/store.server";

const mocks = vi.hoisted(() => ({ read: vi.fn<() => Promise<AdminEditionRow[]>>(), configured: vi.fn(() => true) }));
vi.mock("@/lib/editorials/store.server", () => ({ readPreviewEditions: mocks.read }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({}), hasSupabaseServiceConfig: mocks.configured }));

import { GET } from "@/app/editorials/preview.xml/route";
import { previewTitle } from "@/lib/editorials/previewFeed";
import { NOW } from "./editorialFixtures";

const TOKEN = "preview-token-for-tests-only";

function row(overrides: Partial<AdminEditionRow>): AdminEditionRow {
  return {
    id: "e0000000-0000-4000-8000-000000000001", slot_key: "2026-W44:s0", is_test: false, slug: "an-edition", status: "held",
    title: "An edition", dek: "A dek.", body_md: "## The forecast\n\nClear skies.", facts_box: null, relevance_score: 3,
    writer_model: "claude-opus-5-5", writer_effort: "high", skip_reason: null, hold_hours: 24,
    created_at: "2026-10-26T14:00:00Z", publish_at: null, published_at: null, vetoed_at: null, ...overrides,
  };
}

function request(token?: string) {
  return new Request(`https://crimsonreporthub.com/editorials/preview.xml${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`);
}

beforeEach(() => {
  vi.stubEnv("COLUMN_PREVIEW_TOKEN", TOKEN);
  mocks.read.mockResolvedValue([
    row({}),
    row({ id: "e2", status: "skipped", title: null, slug: null, body_md: null, skip_reason: "provider_unavailable", slot_key: "2026-W43:s0" }),
    row({ id: "e3", is_test: true, slot_key: "test:2026-10-26", writer_model: "claude-sonnet-5-5", title: "Sonnet try" }),
    row({ id: "e4", status: "vetoed", vetoed_at: "2026-10-25T10:00:00Z", title: "Vetoed one" }),
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe("the private preview feed", () => {
  it("is off when no token is configured", async () => {
    vi.stubEnv("COLUMN_PREVIEW_TOKEN", "");
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong token without reading anything", async () => {
    for (const token of [undefined, "", "wrong-token", `${TOKEN}x`]) {
      const response = await GET(request(token));
      expect(response.status).toBe(401);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves held, skipped, vetoed and test rows with status labels and noindex", async () => {
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const xml = await response.text();
    expect(xml).toContain("[Waiting for approval] An edition");
    expect(xml).toContain("[Skipped: provider_unavailable] Slot 2026-W43:s0");
    expect(xml).toContain("TEST · Sonnet 5.5 · Sonnet try");
    expect(xml).toContain("[Vetoed] Vetoed one");
    expect(xml).toContain("/operator?view=column&amp;edition=");
    expect(xml).not.toContain(TOKEN);
  });

  it("labels test drafts with their model and held editions with their publish time", () => {
    expect(previewTitle(row({ is_test: true, writer_model: "claude-fable-5-1", title: "Try" }), NOW)).toBe("TEST · Fable 5.1 · Try");
    expect(previewTitle(row({ publish_at: "2026-10-27T14:00:00Z" }), NOW)).toBe("[Held until Oct 27, 14:00 UTC] An edition");
    expect(previewTitle(row({ publish_at: "2026-10-26T14:00:00Z" }), NOW)).toBe("[Published] An edition");
  });

  it("reports an unavailable database as 503, not an empty feed", async () => {
    mocks.read.mockRejectedValue(new Error("Editorials are unavailable."));
    expect((await GET(request(TOKEN))).status).toBe(503);
  });
});
