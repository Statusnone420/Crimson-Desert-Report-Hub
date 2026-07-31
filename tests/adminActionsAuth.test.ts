import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authentication regression coverage for every admin server write action.
 *
 * The rest of the admin unit suite mocks requireAdmin to a silent no-op, so all
 * of these actions would keep passing with the guard deleted. This file closes
 * that gap behaviorally: requireAdmin is mocked to reject the way the real one
 * does (Next's redirect() throws), every database and external boundary is a
 * tripwire, and each action is called with a payload that WOULD mutate if the
 * guard were gone. Removing or reordering requireAdmin makes an action either
 * resolve or reject with a tripwire message instead of the sentinel — both
 * break the assertions. tests/adminGuard.test.ts covers the other bypass
 * route: hollowing out requireAdmin itself.
 */

const AUTH_SENTINEL = "auth sentinel: admin session required";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  draftDossierWithAi: vi.fn(),
  from: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
  redirect: vi.fn(),
  refreshClusterVisibility: vi.fn(),
  requireAdmin: vi.fn(),
  rescueCandidateSignal: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  rpc: vi.fn(),
  unstableCache: vi.fn((fn: unknown) => fn),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
  unstable_cache: mocks.unstableCache,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/ai", () => ({ draftDossierWithAi: mocks.draftDossierWithAi }));
vi.mock("@/lib/automation/run", () => ({
  refreshClusterVisibility: mocks.refreshClusterVisibility,
  rescueCandidateSignal: mocks.rescueCandidateSignal,
}));
vi.mock("@/lib/officialPatch.server", () => ({ getCurrentPatchMetadata: mocks.getCurrentPatchMetadata }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

type Actions = typeof import("@/app/admin/actions");

/**
 * Every write action, each with a payload valid enough to reach its first
 * tripwired boundary were the auth guard removed. Input validation happening
 * before the guard would also be caught here: the rejection message would be
 * "bad input" instead of the sentinel.
 */
const WRITE_ACTIONS: { name: keyof Actions; form: Record<string, string> }[] = [
  { name: "moderateReport", form: { id: "report-one", decision: "approved", cluster_id: "cluster-one" } },
  { name: "setClusterFixStatus", form: { cluster_id: "cluster-one", fix_status: "verified_fixed" } },
  {
    name: "setClusterVisibilityOverride",
    form: {
      cluster_id: "cluster-one",
      visibility: "force_public",
      reason: "Reviewed evidence warrants temporary public visibility.",
      confirm_override: "true",
    },
  },
  { name: "clearClusterFixStatusOverride", form: { cluster_id: "cluster-one" } },
  { name: "setCurrentPatchOverride", form: { patch_version: "1.13.02" } },
  { name: "compileDossier", form: {} },
  { name: "setAutomationPaused", form: { paused: "true" } },
  { name: "setScannerPolicy", form: { paused: "false", minIntervalMinutes: "120" } },
  {
    name: "recordScannerDecision",
    form: {
      id: "candidate-one",
      decision: "off_topic",
      reason: "This source is unrelated to Crimson Desert.",
      scope: "exact_url",
    },
  },
  {
    name: "rejectObservationAndTeach",
    form: {
      id: "observation-one",
      decision: "off_topic",
      reason: "This item is unrelated to the current patch.",
      scope: "exact_url",
    },
  },
  // Delegates to recordScannerDecision; proves the compatibility path stays gated.
  { name: "rescueRejectedCandidate", form: { id: "candidate-one" } },
  { name: "undoScannerDecision", form: { decision_id: "decision-one" } },
];

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.clearAllMocks();
  vi.resetModules();
  mocks.requireAdmin.mockRejectedValue(new Error(AUTH_SENTINEL));
  // Any boundary reached without a session is itself a failure; throwing here
  // turns a bypassed guard into a loud, distinguishable rejection.
  mocks.from.mockImplementation(() => {
    throw new Error("database read/write reached without an admin session");
  });
  mocks.rpc.mockImplementation(() => {
    throw new Error("database RPC reached without an admin session");
  });
  mocks.rescueCandidateSignal.mockImplementation(() => {
    throw new Error("external rescue work reached without an admin session");
  });
  mocks.refreshClusterVisibility.mockImplementation(() => {
    throw new Error("cluster refresh reached without an admin session");
  });
  mocks.draftDossierWithAi.mockImplementation(() => {
    throw new Error("AI drafting reached without an admin session");
  });
  mocks.getCurrentPatchMetadata.mockImplementation(() => {
    throw new Error("patch metadata read reached without an admin session");
  });
});

describe("admin write actions require authentication before any work", () => {
  for (const { name, form } of WRITE_ACTIONS) {
    it(`${String(name)} performs no database or external work for an unauthenticated caller`, async () => {
      const actions = await import("@/app/admin/actions");
      const action = actions[name] as (formData: FormData) => Promise<void>;

      await expect(action(buildFormData(form))).rejects.toThrow(AUTH_SENTINEL);

      // At least once, not exactly once: a wrapper adding its own guard on top
      // of a delegate's is a strictly safer change and must not fail here. The
      // removed-guard case is zero calls either way.
      expect(mocks.requireAdmin).toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.rescueCandidateSignal).not.toHaveBeenCalled();
      expect(mocks.refreshClusterVisibility).not.toHaveBeenCalled();
      expect(mocks.draftDossierWithAi).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  }

  it("leaves no exported admin action outside this coverage", async () => {
    // A new server action must be added to WRITE_ACTIONS, or its exemption
    // argued here the way signOutAdmin's is. Without this, the file's claim of
    // covering "every admin write action" would rot silently as actions.ts grows.
    const actions = await import("@/app/admin/actions");
    const exported = Object.keys(actions).filter(
      (key) => typeof (actions as Record<string, unknown>)[key] === "function",
    );

    expect(new Set(exported)).toEqual(
      new Set<string>([...WRITE_ACTIONS.map(({ name }) => String(name)), "signOutAdmin"]),
    );
  });

  it("signOutAdmin is deliberately unauthenticated and never touches the database", async () => {
    // Sign-out must work for expired or forged sessions; the exemption is safe
    // only while the action stays database-free, which is what this pins.
    const { signOutAdmin } = await import("@/app/admin/actions");

    await signOutAdmin();

    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "cd_admin",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
  });
});
