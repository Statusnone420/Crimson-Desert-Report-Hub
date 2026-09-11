import { describe, expect, it } from "vitest";

import { resolveLoginReturn } from "@/lib/loginReturn";

describe("resolveLoginReturn", () => {
  it("restores only the recognized scanner collection section", () => {
    expect(resolveLoginReturn("/operator?view=scanner&section=collection")).toBe("/operator?view=scanner&section=collection#collection-health");
    expect(resolveLoginReturn("/operator?view=scanner&section=collection&section=other")).toBe("/operator?view=scanner");
    expect(resolveLoginReturn("/operator?view=reports&section=collection")).toBe("/operator?view=reports");
    expect(resolveLoginReturn("/operator?view=scanner&section=https://evil.example")).toBe("/operator?view=scanner");
  });
  it("restores an exact workspace destination while dropping unrelated redirect parameters", () => {
    expect(resolveLoginReturn("/operator?view=claims&item=claim-1")).toBe("/operator?view=claims&item=claim-1");
    expect(resolveLoginReturn("/operator?view=dossiers&run=run-1&redirect=https://evil.example")).toBe("/operator?view=dossiers&run=run-1");
    expect(resolveLoginReturn("/operator?view=https://evil.example")).toBe("/admin");
    expect(resolveLoginReturn("/operator?view=reports&view=claims")).toBe("/admin");
  });
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
