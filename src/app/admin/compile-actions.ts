"use server";

import { compileDossier } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/adminGuard";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import {
  dossierCompileFailureState,
  type DossierCompileActionState,
} from "@/lib/dossierCompileActionState";

/**
 * Keeps expected compile blockers in the form while compileDossier remains
 * the only code path that gathers data, writes a run, and redirects.
 */
export async function compileDossierState(
  _previous: DossierCompileActionState,
  formData: FormData,
): Promise<DossierCompileActionState> {
  await requireAdmin("/admin/compile");
  assertProductionWriteAllowed();

  try {
    await compileDossier(formData);
  } catch (error) {
    const state = dossierCompileFailureState(error);
    if (state) return state;
    throw error;
  }

  throw new Error("compileDossier completed without redirecting to its saved run");
}
