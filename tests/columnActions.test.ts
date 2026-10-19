import { beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_SENTINEL = "auth sentinel: admin session required";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  preview: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/previewGuard", () => ({ assertProductionWriteAllowed: () => { if (mocks.preview()) throw new Error("preview writes disabled"); } }));

import { approveEdition, setColumnPaused, vetoEdition } from "@/app/operator/column-actions";

const ID = "e0000000-0000-4000-8000-000000000001";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function updateChain(result: { data: unknown; error: unknown }) {
  const chain = { update: vi.fn(), eq: vi.fn(), in: vi.fn(), select: vi.fn(async () => result) };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.preview.mockReturnValue(false);
});

describe("Column card actions", () => {
  it("require an admin session before touching anything", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error(AUTH_SENTINEL));
    mocks.from.mockImplementation(() => { throw new Error("tripwire: database"); });
    mocks.rpc.mockImplementation(() => { throw new Error("tripwire: rpc"); });
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow(AUTH_SENTINEL);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("are disabled on preview deployments", async () => {
    mocks.preview.mockReturnValue(true);
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow("preview writes disabled");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("pause merges only the paused key", async () => {
    mocks.rpc.mockResolvedValue({ data: { paused: true }, error: null });
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow("NEXT_REDIRECT /operator?view=column&notice=paused");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_settings_merge", { p_patch: { paused: true } });
    await expect(setColumnPaused(form({ paused: "maybe" }))).rejects.toThrow("Choose pause or resume");
  });

  it("veto sets vetoed and revalidates every public surface plus the editorials cache", async () => {
    const chain = updateChain({ data: [{ id: ID }], error: null });
    mocks.from.mockReturnValue(chain);
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow("notice=vetoed");
    expect(mocks.from).toHaveBeenCalledWith("editorials");
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "vetoed", vetoed_at: expect.any(String) }));
    expect(chain.in).toHaveBeenCalledWith("status", ["held", "published"]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-editorials", { expire: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed.xml");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/editorials/[slug]", "page");
  });

  it("veto of an edition already gone changes nothing and says so", async () => {
    mocks.from.mockReturnValue(updateChain({ data: [], error: null }));
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow("notice=not_vetoable");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("approve publishes through the database function and revalidates", async () => {
    mocks.rpc.mockResolvedValue({ data: "approved", error: null });
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow("notice=approved");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_approve", { p_id: ID });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-editorials", { expire: 0 });
  });

  it("approve of an edition no longer waiting changes nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: "not_pending", error: null });
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow("notice=not_pending");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("refuse a malformed edition id before any database call", async () => {
    await expect(vetoEdition(form({ id: "not-a-uuid" }))).rejects.toThrow("could not be found");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
