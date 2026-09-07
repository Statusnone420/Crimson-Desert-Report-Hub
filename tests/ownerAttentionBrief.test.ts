import { describe, expect, it } from "vitest";
import {
  OWNER_ATTENTION_BRIEF_QUERY,
  ownerBriefBullets,
  parseOwnerAttentionBrief,
  readOwnerAttentionBrief,
} from "@/lib/ownerAttentionBrief";
import type { createServiceClient } from "@/lib/supabase";

const okBrief = {
  observedAt: "2026-09-07T14:00:00Z",
  status: "ok",
  videoInbox: {
    awaitingReview: { count: 1, oldestAgeSeconds: 3600 },
    draftsReady: { count: 1, oldestAgeSeconds: 7200 },
    items: [
      {
        title: "Fixture title",
        channel: "FixtureChannel",
        state: "pending",
        ageSeconds: 3600,
        reviewReason: "Invented reason",
        adminPath: "/admin/videos",
      },
    ],
  },
  adminAttention: {
    flaggedPendingReports: 1,
    unsureClaimMatches: 1,
    needsYou: 2,
    reportQueuePath: "/admin",
    scannerQueuePath: "/scanner",
  },
};

function stubRpc(result: { data: unknown; error: { code?: string; message: string } | null }) {
  return {
    rpc: async (name: string) => {
      expect(name).toBe("owner_attention_brief");
      return result;
    },
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("owner attention brief", () => {
  it("documents the exact connector query", () => {
    expect(OWNER_ATTENTION_BRIEF_QUERY).toBe("select public.owner_attention_brief();");
  });

  it("keeps the JSON free of report bodies, evidence URLs, and video IDs", () => {
    const parsed = parseOwnerAttentionBrief(okBrief);
    const blob = JSON.stringify(parsed);
    expect(blob).not.toContain("https://");
    expect(blob).not.toContain("zzInboxMock");
    expect(blob).not.toContain("evidence");
    expect(parsed.videoInbox?.items[0]?.adminPath).toBe("/admin/videos");
    expect(parsed.adminAttention?.reportQueuePath).toBe("/admin");
  });

  it("treats missing schema as unavailable, not an empty queue", async () => {
    const brief = await readOwnerAttentionBrief(
      stubRpc({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.owner_attention_brief" },
      }),
    );
    expect(brief.status).toBe("unavailable");
    expect(brief.unavailableReason).toBe("schema_missing");
    expect(brief.videoInbox).toBeNull();
    expect(ownerBriefBullets(brief)).toEqual([
      expect.objectContaining({ section: "keep_an_eye_on", decision: "Video inbox summary unavailable" }),
    ]);
  });

  it("stays quiet when there is no actionable work", () => {
    const quiet = parseOwnerAttentionBrief({
      ...okBrief,
      videoInbox: {
        awaitingReview: { count: 0, oldestAgeSeconds: null },
        draftsReady: { count: 0, oldestAgeSeconds: null },
        items: [],
      },
      adminAttention: { ...okBrief.adminAttention, flaggedPendingReports: 0, unsureClaimMatches: 0, needsYou: 0 },
    });
    expect(ownerBriefBullets(quiet)).toEqual([]);
  });

  it("caps the health-check bullets at five", () => {
    const bullets = ownerBriefBullets(okBrief);
    expect(bullets.length).toBeLessThanOrEqual(5);
    expect(bullets.filter((item) => item.section === "needs_approval").length).toBeGreaterThan(0);
  });
});
