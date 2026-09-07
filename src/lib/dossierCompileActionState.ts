export type DossierCompileActionState = {
  status: "idle" | "error" | "transport_error";
  code: "none" | "patch_unknown" | "unavailable" | "transport";
  message: string;
};

export const initialDossierCompileActionState: DossierCompileActionState = {
  status: "idle",
  code: "none",
  message: "",
};

const PATCH_PROVENANCE_ERROR = "current patch provenance is unknown";
const DATA_READ_ERROR = /^(approved reports|issue clusters|community signals|verified reports|pending reports) read failed:/;

export function dossierCompileFailureState(error: unknown): DossierCompileActionState | null {
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith(PATCH_PROVENANCE_ERROR)) {
    return {
      status: "error",
      code: "patch_unknown",
      message: "The current patch cannot be verified, so no dossier was compiled. Your selected options are still here.",
    };
  }
  if (DATA_READ_ERROR.test(error.message)) {
    return {
      status: "error",
      code: "unavailable",
      message: "The dossier inputs could not be read. No dossier was compiled; your selected options are still here.",
    };
  }
  return null;
}
