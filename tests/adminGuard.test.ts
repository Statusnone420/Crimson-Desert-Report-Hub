import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminSessionSecret, requireAdmin } from "@/lib/adminGuard";
import { ADMIN_COOKIE, createSessionToken } from "@/lib/session";

describe("admin session guard", () => {
  it("treats missing or placeholder session secrets as no public admin session", () => {
    expect(adminSessionSecret({} as NodeJS.ProcessEnv)).toBeNull();
    expect(adminSessionSecret({ SESSION_SECRET: " " } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(adminSessionSecret({ SESSION_SECRET: '""' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(adminSessionSecret({ SESSION_SECRET: "''" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("keeps a real session secret", () => {
    expect(adminSessionSecret({ SESSION_SECRET: "  local-secret  " } as unknown as NodeJS.ProcessEnv)).toBe(
      "local-secret",
    );
  });
});

/**
 * requireAdmin exercised against the real token verification, not a mock.
 * tests/adminActionsAuth.test.ts proves every write action stops when this
 * guard rejects; this block proves the guard itself rejects everything short
 * of a genuinely signed, unexpired session cookie. Together they mean neither
 * deleting the call sites nor hollowing out the guard passes the suite.
 */
describe("requireAdmin", () => {
  const SECRET = "test-session-secret";

  function stubCookieStore(value?: string) {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (value !== undefined && name === ADMIN_COOKIE ? { name, value } : undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>);
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(cookies).mockReset();
    vi.mocked(redirect).mockReset();
    // The real redirect() throws; emulating that is what makes "guard rejects
    // → nothing after it runs" hold in the action-level tests.
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to the login page when no admin cookie is present", async () => {
    stubCookieStore(undefined);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("carries a page's path through to the login form so sign-in can return there", async () => {
    stubCookieStore(undefined);

    await expect(requireAdmin("/admin/compile")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login?from=%2Fadmin%2Fcompile");
  });

  it("redirects when the cookie was signed with a different secret", async () => {
    stubCookieStore(createSessionToken("some-other-secret"));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("redirects when the session token has expired", async () => {
    stubCookieStore(createSessionToken(SECRET, -60_000));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("redirects when no session secret is configured, even with a well-formed cookie", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    stubCookieStore(createSessionToken(SECRET));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("passes a genuinely signed, unexpired session through without redirecting", async () => {
    stubCookieStore(createSessionToken(SECRET));

    await expect(requireAdmin()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
