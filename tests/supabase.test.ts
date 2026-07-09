import { describe, expect, it, vi } from "vitest";
import { hasSupabaseServiceConfig } from "@/lib/supabase";

vi.mock("server-only", () => ({}));

describe("hasSupabaseServiceConfig", () => {
  it("treats quoted-empty service values as missing", () => {
    expect(
      hasSupabaseServiceConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "\"\"",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("requires both Supabase URL and service role key", () => {
    expect(
      hasSupabaseServiceConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(hasSupabaseServiceConfig({ SUPABASE_URL: "https://example.supabase.co" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
