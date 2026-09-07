import { describe, expect, it } from "vitest";

import { resolveLoginReturn } from "@/lib/loginReturn";

describe("resolveLoginReturn", () => {
  it("returns each allowlisted operator destination", () => {
    expect(resolveLoginReturn("/admin")).toBe("/admin");
    expect(resolveLoginReturn("/admin/compile")).toBe("/admin/compile");
    expect(resolveLoginReturn("/admin/videos")).toBe("/admin/videos");
    expect(resolveLoginReturn("/scanner")).toBe("/scanner");
    expect(resolveLoginReturn("/operator")).toBe("/operator");
  });

  it("falls back to the console home when nothing was carried through", () => {
    expect(resolveLoginReturn(null)).toBe("/admin");
    expect(resolveLoginReturn(undefined)).toBe("/admin");
    expect(resolveLoginReturn("")).toBe("/admin");
  });

  it("never lets a crafted ?from= turn sign-in into an open redirect", () => {
    expect(resolveLoginReturn("https://evil.example")).toBe("/admin");
    expect(resolveLoginReturn("//evil.example")).toBe("/admin");
    expect(resolveLoginReturn("/admin/../report")).toBe("/admin");
    expect(resolveLoginReturn("/admin/compile/../../api/admin/export")).toBe("/admin");
    expect(resolveLoginReturn("/scanner?x=1")).toBe("/admin");
    expect(resolveLoginReturn("javascript:alert(1)")).toBe("/admin");
  });
});
