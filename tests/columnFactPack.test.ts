import { describe, expect, it } from "vitest";
import { isPublicSourceUrl } from "@/lib/editorials/content";
import { buildFactPack, evidenceLabel, statusLabel } from "@/lib/editorials/factPack";
import { issueBoard, siteName } from "@/lib/editorials/factPack.server";
import { history, issue, PACK_NOW, patch, samplePack } from "./columnPackFixtures";

describe("evidence labels", () => {
  it("never go past what the public issue page shows", () => {
    expect(evidenceLabel(issue({ officialFixListed: true }))).toBe("Confirmed");
    expect(evidenceLabel(issue({ approvedReports: 2 }))).toBe("Reported");
    expect(evidenceLabel(issue({ checkinNetworks: 2 }))).toBe("Reported");
    expect(evidenceLabel(issue({ approvedReports: 1 }))).toBe("One report");
    expect(evidenceLabel(issue({ checkinNetworks: 1, checkins: 1 }))).toBe("One report");
    // Ten forum links are not ten people: no label at all.
    expect(evidenceLabel(issue({ publicPosts: 10, postsBySite: { "Steam Community": 10 } }))).toBeNull();
  });

  it("keeps status separate from evidence", () => {
    expect(statusLabel(issue({ officialFixListed: true }))).toBe("Fixed (per patch notes)");
    expect(statusLabel(issue({ officialFixListed: true, stillHappening: true }))).toBe("Still happening");
    expect(statusLabel(issue({}))).toBeNull();
  });
});

describe("the fact pack", () => {
  it("gives every fact a stable id, a period and a public Hub or Pearl Abyss source", () => {
    const pack = samplePack();
    expect(pack.facts.map((fact) => fact.id)).toEqual(["P1", "F1", "F2", "S1", "S2", "S3", "S4", "T1", "C1", "K1"]);
    for (const fact of pack.facts) {
      expect(isPublicSourceUrl(fact.source.url)).toBe(true);
      expect(fact.period).toBeTruthy();
    }
    expect(pack.facts.find((fact) => fact.id === "C1")).toMatchObject({ label: "Reported", source: { url: "/issues#issue-00000000-0000-4000-8000-0000000000aa" } });
    expect(pack.facts.find((fact) => fact.id === "P1")?.text).toBe("Patch 2.03.02 (hotfix) official notes published Oct 24, 09:00 UTC. The notes list 2 fixes.");
  });

  it("holds aggregates only: no post links, no report text, no hashes", () => {
    const text = JSON.stringify(samplePack());
    expect(text).not.toMatch(/steamcommunity\.com|reddit\.com\/r\/|voter_ip_hash|network_hash/);
    expect(text).toContain("Steam Community 3");
  });

  it("states forum-only issues by count, without a label", () => {
    const pack = buildFactPack({ now: PACK_NOW, patches: { available: false }, history: history(), previous: null,
      board: { available: true, patchVersion: "2.03.02", issues: [issue({ publicPosts: 4, postsBySite: { "Steam Community": 4 } })] } });
    const fact = pack.facts.find((item) => item.id === "C1");
    expect(fact?.label).toBeUndefined();
    expect(fact?.text).toContain("Evidence: forum links only, no label.");
    expect(fact?.text).toContain("Mentioned in 4 public posts (Steam Community 4).");
    expect(pack.metrics.patternIssueIds).toEqual([]);
  });

  it("measures deltas against the previous edition's pack", () => {
    const first = samplePack();
    const pack = buildFactPack({
      now: PACK_NOW,
      patches: { available: true, editions: [patch("2.04.00", "2026-10-26T09:00:00Z"), patch("2.03.02", "2026-10-24T09:00:00Z")] },
      history: history(25_000, 4_000),
      board: { available: true, patchVersion: "2.04.00", issues: [issue({ approvedReports: 2 }), issue({ id: "00000000-0000-4000-8000-0000000000bb", checkinNetworks: 2, checkins: 2 })] },
      previous: first.metrics,
    });
    expect(pack.deltas).toMatchObject({ newPatchVersions: ["2.04.00"], newUpdate: true, newPatternIssueIds: ["00000000-0000-4000-8000-0000000000bb"] });
    expect(pack.deltas.playersChangePct).toBeCloseTo(25);
    expect(pack.deltas.twitchChangePct).toBeCloseTo(33.33, 1);
    expect(pack.facts.find((fact) => fact.text.startsWith("Steam players online averaged"))?.text).toContain("up 25% since the last edition");
  });

  it("always describes the newly Reported issues that raise the score, even past the first eight", () => {
    const strong = Array.from({ length: 9 }, (_, index) => issue({ id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, title: `Old ${index}`, strength: 50 - index, approvedReports: 2 }));
    const fresh = issue({ id: "00000000-0000-4000-8000-0000000002aa", title: "New and weak", strength: 1, checkinNetworks: 2, checkins: 2 });
    const previous = { ...samplePack().metrics, patternIssueIds: strong.map((item) => item.id) };
    const pack = buildFactPack({ now: PACK_NOW, patches: { available: false }, history: history(), previous,
      board: { available: true, patchVersion: "2.03.02", issues: [...strong, fresh] } });
    expect(pack.deltas.newPatternIssueIds).toEqual([fresh.id]);
    expect(pack.facts.some((fact) => fact.text.includes("New and weak"))).toBe(true);
    expect(pack.facts.filter((fact) => fact.id.startsWith("C"))).toHaveLength(8);
  });

  it("leaves out the players average when fewer than five of the seven days were recorded", () => {
    const sparse = history();
    sparse.days = sparse.days.map((day, index) => (index >= sparse.days.length - 8 && index % 2 === 0 ? day : { ...day, playersAvg: index >= sparse.days.length - 8 ? null : day.playersAvg }));
    const pack = buildFactPack({ now: PACK_NOW, patches: { available: false }, board: { available: false }, previous: null, history: sparse });
    expect(pack.metrics.playersAvg7d).toBeNull();
    expect(pack.facts.some((fact) => fact.text.startsWith("Steam players online averaged"))).toBe(false);
  });

  it("records unavailable data as gaps instead of inventing facts", () => {
    const pack = buildFactPack({ now: PACK_NOW, patches: { available: false }, board: { available: false }, previous: null,
      history: { ...history(), lanes: { players: "unavailable", twitch: "unavailable", reviews: "unavailable" } } });
    expect(pack.facts).toEqual([]);
    expect(pack.gaps).toEqual(["patches_unavailable", "players_unavailable", "reviews_unavailable", "twitch_unavailable", "issues_unavailable"]);
  });
});

describe("reading the issue board", () => {
  const cluster = (overrides: Record<string, unknown>) => ({
    id: "c1", title: "Map crash", directReportCount: 0, strengthScore: 1, earlierCheckinCount: 0, checkinsAvailable: true,
    confirmations: { affectedCount: 0, affectedNetworks: 0 }, readout: { state: "confirmed", poll: null, hasCurrentClaim: false }, ...overrides,
  });
  const data = (clusters: unknown[], extra: Record<string, unknown> = {}) => ({
    clusters, signalsByCluster: { c1: [{ source_url: "https://steamcommunity.com/app/3321460/discussions/0/123/" }, { source_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/" }] },
    officialClaimsByCluster: {}, officialClaimsUnavailable: false, boardReadFailed: false,
    currentPatch: { version: "2.03.02", source: "official" }, excerptsByCluster: { c1: [{ text: "PRIVATE excerpt", platform: "pc" }] }, ...extra,
  }) as unknown as Parameters<typeof issueBoard>[0];

  it("keeps counts and site names, never post links or excerpts", () => {
    const board = issueBoard(data([cluster({ directReportCount: 1 })]));
    expect(board).toEqual({ available: true, patchVersion: "2.03.02", issues: [expect.objectContaining({ id: "c1", approvedReports: 1, publicPosts: 2, postsBySite: { "Steam Community": 1, Reddit: 1 } })] });
    expect(JSON.stringify(board)).not.toMatch(/discussions|comments|PRIVATE/);
  });

  it("is unavailable when the board read failed, never an empty board", () => {
    expect(issueBoard(data([cluster({})], { boardReadFailed: true }))).toEqual({ available: false });
  });

  it("counts an official fix only when the claim context was read", () => {
    const claims = { c1: [{ key: "k", text: "Fixed", section: null, officialUrl: "https://crimsondesert.pearlabyss.com/" }] };
    expect((issueBoard(data([cluster({ directReportCount: 1 })], { officialClaimsByCluster: claims })) as { issues: { officialFixListed: boolean }[] }).issues[0].officialFixListed).toBe(true);
    expect((issueBoard(data([cluster({ directReportCount: 1 })], { officialClaimsByCluster: claims, officialClaimsUnavailable: true })) as { issues: { officialFixListed: boolean }[] }).issues[0].officialFixListed).toBe(false);
  });

  it("names sites without keeping their paths", () => {
    expect(siteName("https://www.reddit.com/r/x/comments/1")).toBe("Reddit");
    expect(siteName("https://forum.example.com/t/1")).toBe("forum.example.com");
    expect(siteName("https://steamcommunity.com/app/1")).toBe("Steam Community");
    expect(siteName("not a url")).toBeNull();
  });
});
