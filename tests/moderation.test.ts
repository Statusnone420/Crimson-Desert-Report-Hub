import { describe, expect, it } from "vitest";
import { matchCluster, moderateReport, neutralSummary, type ClusterRef } from "@/lib/moderation";

delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_FREE_MODEL;

const clusters: ClusterRef[] = [
  { id: "perf", title: "FPS / performance regression since 1.13.00", category: "performance" },
  { id: "crash", title: "Map-open crash (persists after claimed fix)", category: "crash_startup" },
];

const base = {
  issueTitle: "FPS drops to 20 in open-field combat",
  description: "Frame rate tanks in combat, was smooth before the patch.",
  category: "performance" as const,
  platform: "ps5" as const,
  severity: "high",
  frequency: "often",
};

describe("neutralSummary", () => {
  it("is built only from enums, never the raw title/description", () => {
    const summary = neutralSummary({
      ...base,
      issueTitle: "my email is scammer@evil.com and my SSN is 123-45-6789",
      platform: "pc_steam",
    });
    expect(summary).toContain("PC (Steam)");
    expect(summary).toContain("performance");
    expect(summary).not.toContain("scammer@evil.com");
    expect(summary).not.toContain("123-45-6789");
  });
});

describe("matchCluster", () => {
  it("links a report to a same-category cluster by shared keywords", () => {
    expect(matchCluster(base, clusters)).toBe("perf");
  });

  it("does not cross categories", () => {
    expect(matchCluster({ ...base, category: "audio" }, clusters)).toBeNull();
  });
});

describe("moderateReport", () => {
  it("auto-approves a clean report with a neutral summary and no AI", async () => {
    const decision = await moderateReport(base, clusters);
    expect(decision.status).toBe("approved");
    expect(decision.clusterId).toBe("perf");
    expect(decision.publicSummary).toContain("player reports");
    expect(decision.aiUsed).toBe(false);
  });

  it("does not flag driver versions, frame timings, or save IDs as personal data", async () => {
    const decision = await moderateReport(
      {
        ...base,
        description:
          "NVIDIA driver 546.33 on Windows 11 24H2, DLSS 12.7.10600, frame times 16 6 32 1 48 7 ms, save 1234567890 corrupted since the patch.",
      },
      clusters,
    );
    expect(decision.status).toBe("approved");
    expect(decision.reason).toBe("auto_approved");
  });

  it("flags phone-shaped tokens as personal data", async () => {
    const decision = await moderateReport(
      {
        ...base,
        description: "The game keeps crashing in combat, call me back at 555-123-4567 for details please.",
      },
      clusters,
    );
    expect(decision.status).toBe("pending");
    expect(decision.reason).toBe("flagged_personal_data");
  });

  it("flags reports with personal data for review instead of publishing", async () => {
    const decision = await moderateReport(
      {
        ...base,
        category: "crash_startup",
        issueTitle: "crash on startup, reach me at foo@bar.com",
        description: "The game crashes on startup every single time since the patch dropped.",
      },
      clusters,
    );
    expect(decision.status).toBe("pending");
    expect(decision.reason).toBe("flagged_personal_data");
  });

  it("filters obvious spam and publishes nothing", async () => {
    const decision = await moderateReport(
      {
        ...base,
        category: "other",
        issueTitle: "buy cheap gold coins",
        description: "cheap gold coins and free crypto airdrop, visit our casino site now for accounts",
      },
      clusters,
    );
    expect(decision.status).toBe("spam");
    expect(decision.publicSummary).toBeNull();
  });
});
