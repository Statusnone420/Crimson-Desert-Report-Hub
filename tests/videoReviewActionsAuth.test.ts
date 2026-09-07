import { beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_SENTINEL = "auth sentinel: admin session required";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from }) }));

type Actions = typeof import("@/app/admin/videos/actions");

const WRITE_ACTIONS: { name: keyof Actions; form: Record<string, string> }[] = [
  {
    name: "addVideoReviewCandidate",
    form: {
      url: "https://youtu.be/zzInboxMock",
      source_id: "khraze-gaming",
      title: "Crimson Desert fixture commentary",
      channel_label: "FixtureChannel",
      review_note: "Invented note",
    },
  },
  {
    name: "saveVideoReviewCandidate",
    form: {
      id: "video-1",
      revision: "1",
      url: "https://youtu.be/zzInboxMock",
      source_id: "khraze-gaming",
      title: "Crimson Desert fixture commentary",
      channel_label: "FixtureChannel",
      review_note: "Invented note",
    },
  },
  { name: "approveVideoCandidate", form: { id: "video-1", revision: "1" } },
  { name: "skipVideoCandidate", form: { id: "video-1", revision: "1" } },
];

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.clearAllMocks();
  mocks.requireAdmin.mockRejectedValue(new Error(AUTH_SENTINEL));
  mocks.from.mockImplementation(() => {
    throw new Error("database read/write reached without an admin session");
  });
});

describe("video review write actions require authentication", () => {
  for (const { name, form } of WRITE_ACTIONS) {
    it(`${String(name)} performs no database work for an unauthenticated caller`, async () => {
      const actions = await import("@/app/admin/videos/actions");
      const action = actions[name] as (formData: FormData) => Promise<void>;
      await expect(action(buildFormData(form))).rejects.toThrow(AUTH_SENTINEL);
      expect(mocks.requireAdmin).toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("covers every exported video-inbox action", async () => {
    const actions = await import("@/app/admin/videos/actions");
    expect(new Set(Object.keys(actions).filter((key) => typeof (actions as Record<string, unknown>)[key] === "function"))).toEqual(
      new Set(WRITE_ACTIONS.map(({ name }) => String(name))),
    );
  });
});
