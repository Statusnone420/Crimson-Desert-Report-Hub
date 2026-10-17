import { describe, expect, it } from "vitest";
import { reportSchema } from "@/lib/reportSchema";

const valid = {
  patch_version: "1.13.00",
  platform: "ps5",
  category: "performance",
  severity: "high",
  frequency: "often",
  issue_title: "FPS drops to 20 in Heartlands",
  description:
    "Since 1.13.00 frame rate tanks in open field combat, was smooth on 1.12. Happens in performance mode.",
};

describe("reportSchema", () => {
  it("accepts a minimal valid report", () => {
    const r = reportSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects short titles and descriptions", () => {
    expect(reportSchema.safeParse({ ...valid, issue_title: "bad" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, description: "too short" }).success).toBe(false);
  });

  it("rejects unknown platform/category/severity/frequency", () => {
    expect(reportSchema.safeParse({ ...valid, platform: "n64" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, category: "vibes" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, severity: "catastrophic" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, frequency: "constantly" }).success).toBe(false);
  });

  it("accepts optional fields as empty strings and normalizes them to null", () => {
    const r = reportSchema.safeParse({ ...valid, repro_steps: "", evidence_url: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.repro_steps).toBeNull();
      expect(r.data.evidence_url).toBeNull();
    }
  });

  it("rejects a non-url evidence_url", () => {
    expect(reportSchema.safeParse({ ...valid, evidence_url: "not a url" }).success).toBe(false);
  });

  it("rejects non-http(s) evidence url schemes", () => {
    expect(reportSchema.safeParse({ ...valid, evidence_url: "javascript:alert(1)" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, evidence_url: "data:text/html,hi" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, evidence_url: "ftp://example.com/clip.mp4" }).success).toBe(false);
  });

  it("accepts x.com and reddit.com evidence urls", () => {
    expect(reportSchema.safeParse({ ...valid, evidence_url: "https://x.com/user/status/123" }).success).toBe(
      true,
    );
    expect(
      reportSchema.safeParse({ ...valid, evidence_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/" })
        .success,
    ).toBe(true);
  });

  it("caps description length at 4000", () => {
    expect(reportSchema.safeParse({ ...valid, description: "x".repeat(4001) }).success).toBe(false);
  });
});
