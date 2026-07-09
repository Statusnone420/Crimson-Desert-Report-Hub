import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { adminSessionSecret } from "@/lib/adminGuard";

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
