import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));

describe("admin status route", () => {
  it("reports whether the current browser has an admin session", async () => {
    mocks.isAdmin.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.resetModules();
    vi.doMock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
    const { GET } = await import("@/app/api/admin/status/route");

    const first = await GET();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ admin: false });

    const second = await GET();
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ admin: true });
  });
});
