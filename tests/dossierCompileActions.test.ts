import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertProductionWriteAllowed: vi.fn(),
  compileDossier: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/actions", () => ({ compileDossier: mocks.compileDossier }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/previewGuard", () => ({ assertProductionWriteAllowed: mocks.assertProductionWriteAllowed }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.assertProductionWriteAllowed.mockReturnValue(undefined);
});

describe("compileDossierState", () => {
  it("checks authentication before preview, compilation, or a recoverable result", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("auth sentinel"));
    const { compileDossierState } = await import("@/app/admin/compile-actions");
    const { initialDossierCompileActionState } = await import("@/lib/dossierCompileActionState");

    await expect(compileDossierState(initialDossierCompileActionState, new FormData())).rejects.toThrow("auth sentinel");
    expect(mocks.assertProductionWriteAllowed).not.toHaveBeenCalled();
    expect(mocks.compileDossier).not.toHaveBeenCalled();
  });

  it("keeps preview protection outside its recoverable failure handling", async () => {
    mocks.assertProductionWriteAllowed.mockImplementation(() => { throw new Error("preview sentinel"); });
    const { compileDossierState } = await import("@/app/admin/compile-actions");
    const { initialDossierCompileActionState } = await import("@/lib/dossierCompileActionState");

    await expect(compileDossierState(initialDossierCompileActionState, new FormData())).rejects.toThrow("preview sentinel");
    expect(mocks.compileDossier).not.toHaveBeenCalled();
  });

  it("returns a typed state for the known patch-provenance blocker", async () => {
    mocks.compileDossier.mockRejectedValue(new Error("current patch provenance is unknown: source failed"));
    const { compileDossierState } = await import("@/app/admin/compile-actions");
    const { initialDossierCompileActionState } = await import("@/lib/dossierCompileActionState");

    await expect(compileDossierState(initialDossierCompileActionState, new FormData())).resolves.toEqual({
      status: "error",
      code: "patch_unknown",
      message: "The current patch cannot be verified, so no dossier was compiled. Your selected options are still here.",
    });
  });

  it("returns a generic state for a known input-read failure without exposing its details", async () => {
    mocks.compileDossier.mockRejectedValue(new Error("approved reports read failed: permission denied"));
    const { compileDossierState } = await import("@/app/admin/compile-actions");
    const { initialDossierCompileActionState } = await import("@/lib/dossierCompileActionState");

    const state = await compileDossierState(initialDossierCompileActionState, new FormData());
    expect(state).toEqual({
      status: "error",
      code: "unavailable",
      message: "The dossier inputs could not be read. No dossier was compiled; your selected options are still here.",
    });
    expect(state.message).not.toContain("permission denied");
  });

  it("preserves the Next redirect and unexpected failures", async () => {
    const { compileDossierState } = await import("@/app/admin/compile-actions");
    const { initialDossierCompileActionState } = await import("@/lib/dossierCompileActionState");
    mocks.compileDossier.mockRejectedValueOnce(new Error("NEXT_REDIRECT;replace;/operator?view=dossiers&run=run-1"));
    await expect(compileDossierState(initialDossierCompileActionState, new FormData())).rejects.toThrow("NEXT_REDIRECT");

    mocks.compileDossier.mockRejectedValueOnce(new TypeError("cannot read properties of undefined"));
    await expect(compileDossierState(initialDossierCompileActionState, new FormData())).rejects.toThrow("cannot read properties");
  });
});
