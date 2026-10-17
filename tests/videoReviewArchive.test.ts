import { describe, expect, it, vi } from "vitest";
import type { createServiceClient } from "@/lib/supabase";
import {
  archiveVideoReviewCandidate,
  restoreVideoReviewCandidate,
  approveVideoReviewCandidate,
  skipVideoReviewCandidate,
  updateVideoReviewCandidate,
  StaleVideoReviewEdit,
  type VideoReviewRow,
} from "@/lib/videoReviewStore";
import type { NormalizedVideoReviewCandidate } from "@/lib/videoReview";

function clientFor(state: VideoReviewRow["state"], revision = 4) {
  const row = { id: "candidate-1", state, revision };
  const rpc = vi.fn().mockResolvedValue({ data: { candidate: row, draft: null }, error: null });
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [row], error: null }) }) }) }),
    rpc,
  } as unknown as ReturnType<typeof createServiceClient>;
  return { client, rpc, row };
}

describe("archiving private video drafts", () => {
  it("archives through the revision-checked transaction without a new draft payload", async () => {
    const { client, rpc } = clientFor("draft_ready");
    await archiveVideoReviewCandidate(client, "candidate-1", 4);
    expect(rpc).toHaveBeenCalledWith("mutate_video_review_candidate", {
      p_id: "candidate-1", p_revision: 4, p_operation: "archive", p_candidate: null, p_draft: null,
    });
  });

  it("keeps a repeated archive read-only", async () => {
    const { client, rpc, row } = clientFor("archived");
    expect(await archiveVideoReviewCandidate(client, row.id, 1)).toEqual(row);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["pending", "skipped"] as const)("does not archive a %s candidate", async (state) => {
    const { client, rpc } = clientFor(state);
    await expect(archiveVideoReviewCandidate(client, "candidate-1", 4)).rejects.toThrow("Only a ready");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects stale archive and restore submissions before writing", async () => {
    for (const [state, action] of [["draft_ready", archiveVideoReviewCandidate], ["archived", restoreVideoReviewCandidate]] as const) {
      const { client, rpc } = clientFor(state);
      await expect(action(client, "candidate-1", 3)).rejects.toBeInstanceOf(StaleVideoReviewEdit);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("restores through the same transaction and retains the existing draft", async () => {
    const { client, rpc } = clientFor("archived");
    await restoreVideoReviewCandidate(client, "candidate-1", 4);
    expect(rpc).toHaveBeenCalledWith("mutate_video_review_candidate", {
      p_id: "candidate-1", p_revision: 4, p_operation: "restore", p_candidate: null, p_draft: null,
    });
  });

  it.each(["pending", "skipped", "draft_ready"] as const)("does not restore a %s candidate", async (state) => {
    const { client, rpc } = clientFor(state);
    await expect(restoreVideoReviewCandidate(client, "candidate-1", 4)).rejects.toThrow("Only an archived");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires an explicit restore before editing, approving, or skipping", async () => {
    const { client, rpc } = clientFor("archived");
    await expect(approveVideoReviewCandidate(client, "candidate-1", 4)).rejects.toThrow("Restore");
    await expect(skipVideoReviewCandidate(client, "candidate-1", 4)).rejects.toThrow("Restore");
    await expect(updateVideoReviewCandidate(client, "candidate-1", 4, {} as NormalizedVideoReviewCandidate))
      .rejects.toThrow("Restore");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces transaction failures", async () => {
    const { client, rpc } = clientFor("draft_ready");
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(archiveVideoReviewCandidate(client, "candidate-1", 4)).rejects.toThrow("permission denied");
  });
});
