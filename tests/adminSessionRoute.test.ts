import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn<() => string | undefined>(), generation: vi.fn<() => Promise<number | null>>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "cd_admin" && mocks.cookie() ? { name, value: mocks.cookie() } : undefined) }),
}));
vi.mock("@/lib/adminSessions.server", () => ({ currentSessionGeneration: mocks.generation }));

import { POST } from "@/app/api/admin/session/route";
import { SESSION_RENEW_AFTER_MS, createSessionToken, readSessionToken } from "@/lib/session";

const SECRET = "session-route-tests-0123456789abcdef";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SESSION_SECRET", SECRET);
  mocks.cookie.mockReset();
  mocks.generation.mockReset().mockResolvedValue(1);
});

describe("admin session renewal", () => {
  it("re-issues a day-old session for another 30 days", async () => {
    const issuedAt = Date.now() - SESSION_RENEW_AFTER_MS - 1000;
    mocks.cookie.mockReturnValue(createSessionToken(SECRET, 1, issuedAt));
    const res = await POST();
    expect(res.status).toBe(204);
    const renewed = readSessionToken(res.cookies.get("cd_admin")?.value, SECRET);
    expect(renewed?.generation).toBe(1);
    expect(renewed!.issuedAt).toBeGreaterThan(issuedAt);
    expect(res.cookies.get("cd_admin")).toMatchObject({ httpOnly: true, path: "/", maxAge: 2592000 });
  });

  it("leaves a fresh session alone without reading the database", async () => {
    mocks.cookie.mockReturnValue(createSessionToken(SECRET, 1));
    const res = await POST();
    expect(res.status).toBe(204);
    expect(res.cookies.get("cd_admin")).toBeUndefined();
    expect(mocks.generation).not.toHaveBeenCalled();
  });

  it("never renews a session from before Sign out everywhere", async () => {
    mocks.generation.mockResolvedValue(2);
    mocks.cookie.mockReturnValue(createSessionToken(SECRET, 1, Date.now() - 2 * SESSION_RENEW_AFTER_MS));
    const res = await POST();
    expect(res.status).toBe(401);
    expect(res.cookies.get("cd_admin")).toBeUndefined();
  });

  it("refuses missing, forged, and expired sessions", async () => {
    for (const cookie of [undefined, createSessionToken("another-secret-0123456789abcdef", 1), createSessionToken(SECRET, 1, Date.now(), -1000)]) {
      mocks.cookie.mockReturnValue(cookie);
      const res = await POST();
      expect(res.status).toBe(401);
      expect(res.cookies.get("cd_admin")).toBeUndefined();
    }
    expect(mocks.generation).not.toHaveBeenCalled();
  });

  it("renews nothing when the generation cannot be read", async () => {
    mocks.generation.mockResolvedValue(null);
    mocks.cookie.mockReturnValue(createSessionToken(SECRET, 1, Date.now() - 2 * SESSION_RENEW_AFTER_MS));
    const res = await POST();
    expect(res.status).toBe(503);
    expect(res.cookies.get("cd_admin")).toBeUndefined();
  });
});
