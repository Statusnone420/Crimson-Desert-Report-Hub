import { initialVideoActionState } from "@/lib/videoReviewActionState";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  archive: vi.fn(),
  assertProductionWriteAllowed: vi.fn(),
  insert: vi.fn(),
  revalidatePath: vi.fn(),
  requireAdmin: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  skip: vi.fn(),
  validate: vi.fn(),
  rejectionMessage: vi.fn(),
  StaleVideoReviewEdit: class StaleVideoReviewEdit extends Error {},
  DuplicateVideoReviewCandidate: class DuplicateVideoReviewCandidate extends Error {},
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/previewGuard", () => ({ assertProductionWriteAllowed: mocks.assertProductionWriteAllowed }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/videoReview", () => ({
  validateVideoReviewCandidate: mocks.validate,
  videoReviewRejectionMessage: mocks.rejectionMessage,
}));
vi.mock("@/lib/videoReviewStore", () => ({
  StaleVideoReviewEdit: mocks.StaleVideoReviewEdit,
  DuplicateVideoReviewCandidate: mocks.DuplicateVideoReviewCandidate,
  approveVideoReviewCandidate: mocks.approve,
  archiveVideoReviewCandidate: mocks.archive,
  insertVideoReviewCandidate: mocks.insert,
  restoreVideoReviewCandidate: mocks.restore,
  skipVideoReviewCandidate: mocks.skip,
  updateVideoReviewCandidate: mocks.save,
}));

const form = () => new FormData();
const candidate = { videoId: "zzInboxMock" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.assertProductionWriteAllowed.mockReturnValue(undefined);
  mocks.validate.mockReturnValue({ ok: true, candidate });
  mocks.rejectionMessage.mockReturnValue("Only YouTube video URLs are accepted.");
  mocks.insert.mockResolvedValue({});
  mocks.save.mockResolvedValue({});
  mocks.approve.mockResolvedValue({});
  mocks.skip.mockResolvedValue({});
  mocks.archive.mockResolvedValue({});
  mocks.restore.mockResolvedValue({});
});

describe("video review state actions", () => {
  it("keeps an authentication redirect outside recoverable results", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("auth sentinel"));
    const { addVideoReviewCandidateState } = await import("@/app/admin/videos/actions");

    await expect(addVideoReviewCandidateState(initialVideoActionState, form())).rejects.toThrow("auth sentinel");
    expect(mocks.assertProductionWriteAllowed).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a typed stale result without revalidating away the entered save form", async () => {
    mocks.save.mockRejectedValue(new mocks.StaleVideoReviewEdit("stale"));
    const data = form();
    data.set("id", "video-1");
    data.set("revision", "2");
    const { saveVideoReviewCandidateState } = await import("@/app/admin/videos/actions");

    await expect(saveVideoReviewCandidateState(initialVideoActionState, data)).resolves.toMatchObject({
      status: "error",
      code: "stale",
      message: expect.stringContaining("entered details are still here"),
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns validation feedback without attempting an insert", async () => {
    mocks.validate.mockReturnValue({ ok: false, reason: "not_youtube" });
    const { addVideoReviewCandidateState } = await import("@/app/admin/videos/actions");

    await expect(addVideoReviewCandidateState(initialVideoActionState, form())).resolves.toEqual({
      status: "error",
      code: "validation",
      message: "Only YouTube video URLs are accepted.",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a generic local failure for a known database write failure", async () => {
    mocks.save.mockRejectedValue(new Error("video candidate save failed: database offline"));
    const data = form();
    data.set("id", "video-1");
    data.set("revision", "2");
    const { saveVideoReviewCandidateState } = await import("@/app/admin/videos/actions");

    const state = await saveVideoReviewCandidateState(initialVideoActionState, data);
    expect(state).toEqual({
      status: "error",
      code: "unavailable",
      message: "The private inbox could not save that change. Your entered details are still here; try again.",
    });
    expect(state.message).not.toContain("database offline");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not disguise an unexpected programming failure as a successful write", async () => {
    mocks.save.mockRejectedValue(new TypeError("cannot read properties of undefined"));
    const data = form();
    data.set("id", "video-1");
    data.set("revision", "2");
    const { saveVideoReviewCandidateState } = await import("@/app/admin/videos/actions");

    await expect(saveVideoReviewCandidateState(initialVideoActionState, data)).rejects.toThrow("cannot read properties");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports approval as a private draft and leaves Watch unchanged", async () => {
    const data = form();
    data.set("id", "video-1");
    data.set("revision", "2");
    const { approveVideoCandidateState } = await import("@/app/admin/videos/actions");

    await expect(approveVideoCandidateState(initialVideoActionState, data)).resolves.toEqual({
      status: "success",
      code: "none",
      message: "Private draft prepared. Watch remains unchanged.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/videos");
  });
});
