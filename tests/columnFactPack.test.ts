import { describe, expect, it } from "vitest";
import { isPublicSourceUrl } from "@/lib/editorials/content";
import {
  buildFactPack, editionLead, evidenceLabel, hubCheck, statusLabel,
  type AfterFix, type FactPackDeltas, type FactPackMetrics, type IssueAggregate, type OfficialNotice,
} from "@/lib/editorials/factPack";
import { issueBoard, siteName } from "@/lib/editorials/factPack.server";
import { relevanceScore } from "@/lib/editorials/relevance";
import { history, issue, notice, NOTICE_URL, PACK_NOW, patch, samplePack } from "./columnPackFixtures";

describe("evidence labels", () => {
  it("never go past what the public issue page shows", () => {
    expect(evidenceLabel(issue({ officialFixListed: true }))).toBe("Confirmed");
    expect(evidenceLabel(issue({ approvedReports: 2 }))).toBe("Reported");
    expect(evidenceLabel(issue({ approvedReports: 1 }))).toBe("One report");
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
    expect(pack.facts.map((fact) => fact.id)).toEqual(["P1", "F1", "F2", "S1", "S2", "S3", "S4", "T1", "C1"]);
    for (const fact of pack.facts) {
      expect(isPublicSourceUrl(fact.source.url)).toBe(true);
      expect(fact.period).toBeTruthy();
    }
    expect(pack.facts.find((fact) => fact.id === "C1")).toMatchObject({ label: "Reported", source: { url: "/issues#issue-00000000-0000-4000-8000-0000000000aa" } });
    expect(pack.facts.find((fact) => fact.id === "P1")?.text).toBe("Patch 2.03.02 (hotfix) official notes published Oct 24, 09:00 UTC. The notes list 2 fixes.");
  });

  it("holds aggregates only: no post links, no report text, no hashes, no thumb or general check-in counts", () => {
    const text = JSON.stringify(samplePack());
    expect(text).not.toMatch(/steamcommunity\.com|reddit\.com\/r\/|voter_ip_hash|network_hash/);
    expect(text).not.toMatch(/happening to me|thumb/i);
    expect(text).toContain("Steam Community 3");
  });

  it("states forum-only issues by count, without a label", () => {
    const pack = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, history: history(), previous: null,
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
      now: PACK_NOW, notices: [],
      patches: { available: true, editions: [patch("2.04.00", "2026-10-26T09:00:00Z"), patch("2.03.02", "2026-10-24T09:00:00Z")] },
      history: history(25_000, 4_000),
      board: { available: true, patchVersion: "2.04.00", issues: [issue({ approvedReports: 2 }), issue({ id: "00000000-0000-4000-8000-0000000000bb", approvedReports: 2 })] },
      previous: first.metrics,
    });
    expect(pack.deltas).toEqual({ newPatchVersions: ["2.04.00"], newUpdate: true, newPatternIssueIds: ["00000000-0000-4000-8000-0000000000bb"], newVerdictIssueIds: [], newNoticeIds: [], upcomingReleaseIds: [] });
    expect(pack.facts.find((fact) => fact.text.startsWith("Steam players online averaged"))?.text).toContain("up 25% since the last edition");
    expect(pack.facts.find((fact) => fact.text.startsWith("Twitch viewers averaged"))?.text).toContain("up 33% since the last edition");
  });

  it("keeps a Steam or Twitch swing as context, never as news", () => {
    const swing = buildFactPack({
      now: PACK_NOW, notices: [],
      patches: { available: true, editions: [patch("2.03.02", "2026-10-24T09:00:00Z", ["Fixed an issue where the map could crash.", "Fixed horses stuck in fences."])] },
      history: history(25_000, 4_000),
      board: { available: true, patchVersion: "2.03.02", issues: [issue({ approvedReports: 2, publicPosts: 3, postsBySite: { "Steam Community": 3 } })] },
      previous: samplePack().metrics,
    });
    expect(swing.facts.find((fact) => fact.text.startsWith("Steam players online averaged"))?.text).toContain("up 25% since the last edition");
    expect(relevanceScore(swing.deltas)).toBe(0);
  });

  it("leaves a zero check-in total out, so the column can't narrate an empty board", () => {
    const quiet = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, history: history(), previous: null,
      board: { available: true, patchVersion: "2.03.02", issues: [issue({ publicPosts: 2, postsBySite: { Reddit: 2 } })] } });
    expect(quiet.facts.map((fact) => fact.id)).toEqual(["S1", "S2", "S3", "S4", "T1", "C1"]);
    expect(quiet.facts.find((fact) => fact.id === "C1")?.text).not.toContain("check-in");
    const empty = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, history: history(), previous: null, board: { available: true, patchVersion: "2.03.02", issues: [] } });
    expect(empty.facts.some((fact) => /^[CK]/.test(fact.id))).toBe(false);
    expect(empty.gaps).not.toContain("issues_unavailable");
  });

  it("always describes the newly Reported issues that raise the score, even past the first eight", () => {
    const strong = Array.from({ length: 9 }, (_, index) => issue({ id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, title: `Old ${index}`, strength: 50 - index, approvedReports: 2 }));
    const fresh = issue({ id: "00000000-0000-4000-8000-0000000002aa", title: "New and weak", strength: 1, approvedReports: 2 });
    const previous = { ...samplePack().metrics, patternIssueIds: strong.map((item) => item.id) };
    const pack = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, history: history(), previous,
      board: { available: true, patchVersion: "2.03.02", issues: [...strong, fresh] } });
    expect(pack.deltas.newPatternIssueIds).toEqual([fresh.id]);
    expect(pack.facts.some((fact) => fact.text.includes("New and weak"))).toBe(true);
    expect(pack.facts.filter((fact) => fact.id.startsWith("C"))).toHaveLength(8);
  });

  it("leaves out the players average when fewer than five of the seven days were recorded", () => {
    const sparse = history();
    sparse.days = sparse.days.map((day, index) => (index >= sparse.days.length - 8 && index % 2 === 0 ? day : { ...day, playersAvg: index >= sparse.days.length - 8 ? null : day.playersAvg }));
    const pack = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, board: { available: false }, previous: null, history: sparse });
    expect(pack.metrics.playersAvg7d).toBeNull();
    expect(pack.facts.some((fact) => fact.text.startsWith("Steam players online averaged"))).toBe(false);
  });

  it("dates the all-time review score by the day it was recorded", () => {
    const sparse = history();
    sparse.days = sparse.days.map((day, index) => ({ ...day, lifetimePositive: index === sparse.days.length - 10 ? 79 : null }));
    const pack = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, board: { available: false }, previous: null, history: sparse });
    expect(pack.facts.find((fact) => fact.text.startsWith("Crimson Desert's all-time"))).toMatchObject({
      text: "Crimson Desert's all-time Steam review score was 79% positive.",
      period: "Oct 17 (UTC)",
    });
  });

  it("carries the last known metrics forward for data it can't read, so the next edition compares fairly", () => {
    const patches = { available: true as const, editions: [patch("2.03.02", "2026-10-24T09:00:00Z", ["Fixed an issue where the map could crash.", "Fixed horses stuck in fences."])] };
    const board = { available: true as const, patchVersion: "2.03.02", issues: [issue({ approvedReports: 2 })] };
    const first = buildFactPack({ now: PACK_NOW, notices: [], patches, history: history(), board, previous: null });
    const outage = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, board: { available: false }, previous: first.metrics,
      history: { ...history(), lanes: { players: "unavailable", twitch: "unavailable", reviews: "unavailable" } } });
    expect(outage.metrics).toEqual(first.metrics);
    expect(outage.deltas).toEqual({ newPatchVersions: [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [], newNoticeIds: [], upcomingReleaseIds: [] });
    // The next good read finds nothing new against the carried baseline.
    const next = buildFactPack({ now: PACK_NOW, notices: [], patches, history: history(), board, previous: outage.metrics });
    expect(next.deltas).toEqual({ newPatchVersions: [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [], newNoticeIds: [], upcomingReleaseIds: [] });
    expect(next.facts.find((fact) => fact.text.startsWith("Steam players online averaged"))?.text).toContain("up 0% since the last edition");
  });

  it("marks lists it has never read as unknown, so a later read measures them like a first edition", () => {
    const outage = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, board: { available: false }, previous: null, history: history() });
    expect(outage.metrics).toMatchObject({ patchVersions: null, latestPatch: null, patternIssueIds: null, hubChecks: null });
    const next = buildFactPack({ now: PACK_NOW, notices: [], history: history(), board: { available: false }, previous: outage.metrics,
      patches: { available: true, editions: [patch("2.03.02", "2026-10-24T09:00:00Z"), patch("2.02.00", "2026-09-01T09:00:00Z")] } });
    // Only the patch from the last seven days counts as new, as on a first edition.
    expect(next.deltas.newPatchVersions).toEqual(["2.03.02"]);
  });

  it("records unavailable data as gaps instead of inventing facts", () => {
    const pack = buildFactPack({ now: PACK_NOW, notices: [], patches: { available: false }, board: { available: false }, previous: null,
      history: { ...history(), lanes: { players: "unavailable", twitch: "unavailable", reviews: "unavailable" } } });
    expect(pack.facts).toEqual([]);
    expect(pack.gaps).toEqual(["patches_unavailable", "players_unavailable", "reviews_unavailable", "twitch_unavailable", "issues_unavailable"]);
  });
});

describe("Hub checks on listed fixes", () => {
  const MAP_FIX = "Fixed an issue where the map could crash.";
  const after = (overrides: Partial<AfterFix> = {}): AfterFix => ({
    fixes: [MAP_FIX], readout: "unverified", fixedCheckins: 0, stillCheckins: 0, stillNetworks: 0, reportsSince: 0, ...overrides,
  });
  const patches = (fixes: string[]) => ({ available: true as const, editions: [patch("2.03.02", "2026-10-24T09:00:00Z", fixes)] });
  const board = (issues: IssueAggregate[], patchVersion = "2.03.02") => ({ available: true as const, patchVersion, issues });

  it("never says more than the issue page", () => {
    expect(hubCheck(after({ readout: "players_say_fixed", fixedCheckins: 4 }))).toBe("Confirmed by players");
    expect(hubCheck(after({ readout: "still_happening", stillCheckins: 3, stillNetworks: 2 }))).toBe("Still reported");
    expect(hubCheck(after({ readout: "still_happening", stillCheckins: 1, stillNetworks: 1, reportsSince: 1 }))).toBe("Still reported");
    // A single exact-patch report is one signal, and early check-ins from too few networks don't count yet.
    expect(hubCheck(after({ readout: "still_happening", reportsSince: 1 }))).toBe("Too little to call");
    expect(hubCheck(after({ fixedCheckins: 2 }))).toBe("Too little to call");
    expect(hubCheck(after())).toBe("No Hub signal yet");
  });

  it("never turns thin evidence into a count: several check-ins from one source stay too little to call", () => {
    const pack = buildFactPack({ now: PACK_NOW, notices: [], history: history(), previous: null, patches: patches([MAP_FIX]),
      board: board([issue({ officialFixListed: true, afterFix: after({ fixedCheckins: 2 }) })]) });
    const text = (id: string) => pack.facts.find((item) => item.id === id)?.text ?? "";
    expect(text("C1")).toContain('Since that fix: 2 "fixed for me" check-ins. Since the fix, the Hub has too little evidence to call it either way.');
    expect(text("F1")).toContain("Since the fix, the Hub has too little evidence to call it either way.");
    expect(pack.facts.map((item) => item.text).join(" ")).not.toMatch(/one sighting|only one/i);
  });

  it("pairs each listed fix with its known issue, and both carry the same check", () => {
    const pack = buildFactPack({ now: PACK_NOW, notices: [], history: history(), previous: null, patches: patches([MAP_FIX, "Fixed horses stuck in fences"]),
      board: board([issue({ approvedReports: 2, officialFixListed: true, stillHappening: true, afterFix: after({ readout: "still_happening", stillCheckins: 3, stillNetworks: 2, reportsSince: 1 }) })]) });
    const fact = (id: string) => pack.facts.find((item) => item.id === id);
    expect(fact("F1")).toMatchObject({ check: "Still reported", text: `Patch 2.03.02 lists this fix: "${MAP_FIX}" The Hub links it to the known issue "Crash when opening the map". Players still report it on the Hub after the fix.` });
    expect(fact("F2")).toMatchObject({ check: "No Hub signal yet", text: 'Patch 2.03.02 lists this fix: "Fixed horses stuck in fences". Nothing on the Hub yet.' });
    // One thing per fix line: an unlinked fix never pairs "nothing on the Hub" with "no linked issue".
    expect(pack.facts.map((item) => item.text).join(" ")).not.toMatch(/paired|no known issue/i);
    // A fix line carries no evidence label: the writer once explained that label to readers.
    expect(fact("F1")).not.toHaveProperty("label");
    expect(fact("C1")).toMatchObject({ check: "Still reported", status: "Still happening" });
    expect(fact("C1")?.text).toContain('The notes for patch 2.03.02 list a fix for it. Since that fix: 3 "still happening" check-ins, 1 exact-patch player report. Players still report it on the Hub after the fix.');
    expect(pack.facts.map((item) => item.text).join(" ")).not.toMatch(/Hub check/);
  });

  it("gives a fix line paired with several issues the most cautious check", () => {
    const fixed = issue({ title: "Map crash", officialFixListed: true, afterFix: after({ readout: "players_say_fixed", fixedCheckins: 5 }) });
    // The same line with different spacing still pairs.
    const quiet = issue({ id: "00000000-0000-4000-8000-0000000000bb", title: "Map freeze", officialFixListed: true, afterFix: after({ fixes: [`  ${MAP_FIX.replace(" ", " ")}`] }) });
    const fix = buildFactPack({ now: PACK_NOW, notices: [], history: history(), previous: null, patches: patches([MAP_FIX]), board: board([fixed, quiet]) }).facts.find((item) => item.id === "F1");
    expect(fix?.check).toBe("No Hub signal yet");
    expect(fix?.text).toContain('The Hub links it to the known issues "Map crash", "Map freeze".');
  });

  it("checks no fix against an unread board or a board on another patch", () => {
    const paired = issue({ officialFixListed: true, afterFix: after({ readout: "players_say_fixed", fixedCheckins: 5 }) });
    for (const issues of [{ available: false } as const, board([paired], "2.03.01")]) {
      const fix = buildFactPack({ now: PACK_NOW, notices: [], history: history(), previous: null, patches: patches([MAP_FIX]), board: issues }).facts.find((item) => item.id === "F1");
      expect(fix?.text).toBe(`Patch 2.03.02 lists this fix: "${MAP_FIX}"`);
      expect(fix?.check).toBeUndefined();
    }
  });

  it("counts a new verdict on a listed fix as news once, and reads older packs as never measured", () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    const build = (readout: AfterFix["readout"], previous: FactPackMetrics | null) => buildFactPack({ now: PACK_NOW, notices: [], history: history(), previous,
      patches: patches([MAP_FIX]), board: board([issue({ officialFixListed: true, afterFix: after({ readout, stillCheckins: 2, stillNetworks: 2 }) })]) });
    const first = build("unverified", null);
    expect(first.metrics.hubChecks).toEqual({ [id]: "Too little to call" });
    expect(first.deltas.newVerdictIssueIds).toEqual([]);
    const moved = build("still_happening", first.metrics);
    expect(moved.deltas).toEqual({ newPatchVersions: [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [id], newNoticeIds: [], upcomingReleaseIds: [] });
    expect(relevanceScore(moved.deltas)).toBe(1);
    expect(build("still_happening", moved.metrics).deltas.newVerdictIssueIds).toEqual([]);
    const older: FactPackMetrics = { ...moved.metrics };
    delete older.hubChecks;
    expect(build("still_happening", older).deltas.newVerdictIssueIds).toEqual([id]);
  });
});

describe("reading the issue board", () => {
  const cluster = (overrides: Record<string, unknown>) => ({
    id: "c1", title: "Map crash", directReportCount: 0, strengthScore: 1, earlierCheckinCount: 0, checkinsAvailable: true, postClaimEvidenceCount: 0,
    confirmations: { affectedCount: 0, affectedNetworks: 0, pollFixedCount: 0, pollFixedNetworks: 0, pollStillCount: 0, pollStillNetworks: 0 },
    readout: { state: "confirmed", poll: null, hasCurrentClaim: false }, ...overrides,
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

  it("is unavailable when check-ins could not be read, never zero check-ins", () => {
    expect(issueBoard(data([cluster({ directReportCount: 1 })], { checkinsAvailable: false }))).toEqual({ available: false });
    expect(issueBoard(data([cluster({ directReportCount: 1, checkinsAvailable: false })]))).toEqual({ available: false });
  });

  it("counts an official fix when the claim context was read, and is unavailable when it wasn't", () => {
    const claims = { c1: [{ key: "k", text: "Fixed", section: null, officialUrl: "https://crimsondesert.pearlabyss.com/" }] };
    expect((issueBoard(data([cluster({ directReportCount: 1 })], { officialClaimsByCluster: claims })) as { issues: { officialFixListed: boolean }[] }).issues[0].officialFixListed).toBe(true);
    // An unread claim context never reads as "no listed fix", which would downgrade a fixed issue.
    expect(issueBoard(data([cluster({ directReportCount: 1 })], { officialClaimsByCluster: claims, officialClaimsUnavailable: true }))).toEqual({ available: false });
  });

  it("pairs a listed fix with what players said after it, counted the way the issue page counts", () => {
    const claims = { c1: [{ key: "k", text: "Fixed the map crash.", section: null, officialUrl: "https://crimsondesert.pearlabyss.com/" }] };
    const still = cluster({
      directReportCount: 1, postClaimEvidenceCount: 1, readout: { state: "still_happening", poll: { fixedCount: 1, stillCount: 2, escalated: false }, hasCurrentClaim: true },
      confirmations: { affectedCount: 2, affectedNetworks: 1, pollFixedCount: 1, pollFixedNetworks: 1, pollStillCount: 2, pollStillNetworks: 1 },
    });
    const issues = (clusters: unknown[], extra: Record<string, unknown> = {}) => (issueBoard(data(clusters, extra)) as { issues: IssueAggregate[] }).issues;
    expect(issues([still], { officialClaimsByCluster: claims })[0].afterFix).toEqual({
      fixes: ["Fixed the map crash."], readout: "still_happening", fixedCheckins: 1, stillCheckins: 2, stillNetworks: 1, reportsSince: 1,
    });
    expect(issues([cluster({ directReportCount: 1, readout: { state: "fix_claimed_unverified", poll: null, hasCurrentClaim: true } })], { officialClaimsByCluster: claims })[0].afterFix)
      .toMatchObject({ readout: "unverified" });
    expect(issues([cluster({ directReportCount: 1 })])[0].afterFix).toBeNull();
  });

  it("names sites without keeping their paths", () => {
    expect(siteName("https://www.reddit.com/r/x/comments/1")).toBe("Reddit");
    expect(siteName("https://forum.example.com/t/1")).toBe("forum.example.com");
    expect(siteName("https://steamcommunity.com/app/1")).toBe("Steam Community");
    expect(siteName("not a url")).toBeNull();
  });
});

describe("official notices", () => {
  // The Sep 30 delay notice and the Sep 3 notice whose Oct 15 date it replaced.
  const delay = notice({
    id: "announcement-delay", publishedAt: "2026-09-30T10:20:00Z", release: { id: "charting-the-unknown", at: "2026-10-29T22:00:00Z" },
    says: ["Pearl Abyss moves the release by 2 weeks, to October 29."],
    source: { label: "Pearl Abyss — September 30 release-date update", url: NOTICE_URL },
  });
  const original = notice({
    id: "announcement-original", publishedAt: "2026-09-03T14:00:00Z", release: { id: "charting-the-unknown", at: "2026-10-15T22:00:00Z" },
    says: ["Charting the Unknown is scheduled for October 15."],
    source: { label: "Pearl Abyss — pre-order announcement", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129" },
  });
  const build = (notices: readonly OfficialNotice[], now = PACK_NOW, previous: FactPackMetrics | null = null) =>
    buildFactPack({ now, notices, patches: { available: false }, history: history(), board: { available: false }, previous });
  const noticeFacts = (notices: readonly OfficialNotice[], now = PACK_NOW) => build(notices, now).facts.filter((fact) => fact.id.startsWith("N"));

  it("states an official notice with its publication date, its link and the release it sets", () => {
    const pack = build([delay]);
    expect(pack.facts.find((fact) => fact.id === "N1")).toEqual({
      id: "N1",
      text: "Pearl Abyss official notice published Sep 30, 10:20 UTC. Pearl Abyss moves the release by 2 weeks, to October 29. The notice sets the release for Oct 29, 22:00 UTC.",
      period: "Sep 30, 10:20 UTC",
      value: "2026-10-29T22:00:00Z",
      source: { label: "Pearl Abyss — September 30 release-date update", url: NOTICE_URL },
    });
    // Three days before launch: the release counts, and an old notice isn't new.
    expect(pack.deltas).toMatchObject({ newNoticeIds: [], upcomingReleaseIds: ["charting-the-unknown"] });
    expect(relevanceScore(pack.deltas)).toBe(2);
  });

  it("takes only Pearl Abyss's own pages, never X, Reddit or the Hub's articles", () => {
    const pack = build([
      notice({ id: "x", source: { label: "Official post on X", url: "https://x.com/crimsondesert_/status/1" } }),
      notice({ id: "reddit", source: { label: "Reddit thread", url: "https://www.reddit.com/r/CrimsonDesert/comments/1" } }),
      notice({ id: "hub", source: { label: "Hub report", url: "/articles/charting-the-unknown-delay" } }),
      notice({ id: "official" }),
    ]);
    expect(pack.facts.filter((fact) => fact.id.startsWith("N")).map((fact) => fact.source.url)).toEqual([NOTICE_URL]);
    expect(pack.deltas.newNoticeIds).toEqual(["official"]);
    expect(pack.metrics.noticeIds).toEqual(["official"]);
  });

  it("uses the newest notice for a release and leaves out the date it replaced", () => {
    const pack = build([original, delay]);
    expect(pack.facts.filter((fact) => fact.id.startsWith("N")).map((fact) => fact.source.url)).toEqual([NOTICE_URL]);
    expect(JSON.stringify(pack.facts)).not.toContain("October 15");
    // The replaced notice is still known, so it never counts as new later.
    expect(pack.metrics.noticeIds).toEqual(["announcement-original", "announcement-delay"]);
    // Two days before the old date, nothing counts: Oct 15 is out of date, and Oct 29 is 16 days off.
    expect(build([original, delay], new Date("2026-10-13T22:00:00Z")).deltas.upcomingReleaseIds).toEqual([]);
  });

  it("counts a notice as new once: against the last edition's list, or the last 7 days before there is one", () => {
    const fresh = notice({ id: "fresh", publishedAt: "2026-10-22T09:00:00Z" });
    const old = notice({ id: "old", publishedAt: "2026-10-01T09:00:00Z" });
    const first = build([fresh, old]);
    expect(first.deltas.newNoticeIds).toEqual(["fresh"]);
    expect(relevanceScore(first.deltas)).toBe(2);
    const next = build([fresh, old, notice({ id: "added", publishedAt: "2026-10-26T09:00:00Z" })], PACK_NOW, first.metrics);
    expect(next.deltas.newNoticeIds).toEqual(["added"]);
    expect(next.facts.filter((fact) => fact.id.startsWith("N"))).toHaveLength(1);
    // A pack stored before notices existed has no list: the last 7 days count, as for a first edition.
    const older: FactPackMetrics = { ...first.metrics, noticeIds: undefined };
    expect(build([fresh, old], PACK_NOW, older).deltas.newNoticeIds).toEqual(["fresh"]);
  });

  it("counts a release only within the next 14 days, never one that has started", () => {
    const releaseAt = (at: string) => build([notice({ publishedAt: "2026-09-01T00:00:00Z", release: { id: "launch", at } })]).deltas.upcomingReleaseIds;
    expect(releaseAt("2026-11-09T14:05:00Z")).toEqual(["launch"]);
    expect(releaseAt("2026-11-09T14:06:00Z")).toEqual([]);
    expect(releaseAt("2026-10-26T14:05:00Z")).toEqual([]);
  });

  it("leaves an old notice with no release coming out of the pack", () => {
    const pack = build([notice({ publishedAt: "2026-09-01T00:00:00Z" })]);
    expect(pack.facts.some((fact) => fact.id.startsWith("N"))).toBe(false);
    expect(relevanceScore(pack.deltas)).toBe(0);
  });

  it("keeps the three newest notices, so a busy week can't crowd the pack", () => {
    const notices = ["20", "21", "22", "23"].map((day) => notice({ id: `n${day}`, publishedAt: `2026-10-${day}T09:00:00Z` }));
    expect(noticeFacts(notices).map((fact) => fact.period)).toEqual(["Oct 23, 09:00 UTC", "Oct 22, 09:00 UTC", "Oct 21, 09:00 UTC"]);
  });

  it("states only what the linked page says: its own lines, its date and the release it sets", () => {
    const dated = noticeFacts([notice({ says: undefined, publishedAt: "2026-09-01T00:00:00Z", release: { id: "launch", at: "2026-10-29T22:00:00Z" } })]);
    expect(dated.map((fact) => fact.text)).toEqual(["Pearl Abyss official notice published Sep 1, 00:00 UTC. The notice sets the release for Oct 29, 22:00 UTC."]);
    // Nothing tied to the page and no date it sets: nothing to state, so no fact and no score.
    const bare = build([notice({ says: undefined })]);
    expect(bare.facts.some((fact) => fact.id.startsWith("N"))).toBe(false);
    expect(relevanceScore(bare.deltas)).toBe(0);
  });

  it("dates a release by its newest notice even when that notice has no lines of its own", () => {
    const moved = notice({ id: "moved", says: undefined, publishedAt: "2026-10-20T09:00:00Z", release: { id: "charting-the-unknown", at: "2026-11-05T22:00:00Z" } });
    const facts = noticeFacts([delay, moved]);
    expect(facts.map((fact) => fact.text)).toEqual(["Pearl Abyss official notice published Oct 20, 09:00 UTC. The notice sets the release for Nov 5, 22:00 UTC."]);
  });
});

describe("relevance from official notices", () => {
  const quiet: FactPackDeltas = { newPatchVersions: [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [], newNoticeIds: [], upcomingReleaseIds: [] };

  it("adds 2 for a new notice and 2 for a release within 14 days, at most 3 together", () => {
    expect(relevanceScore(quiet)).toBe(0);
    expect(relevanceScore({ ...quiet, newNoticeIds: ["a", "b"] })).toBe(2);
    expect(relevanceScore({ ...quiet, upcomingReleaseIds: ["launch"] })).toBe(2);
    expect(relevanceScore({ ...quiet, newNoticeIds: ["a"], upcomingReleaseIds: ["launch"] })).toBe(3);
    // The cap is on the notices alone; a new hotfix still adds its own 2.
    expect(relevanceScore({ ...quiet, newPatchVersions: ["2.03.03"], newNoticeIds: ["a"], upcomingReleaseIds: ["launch"] })).toBe(5);
  });

  it("lets a notice lead only when no patch is new", () => {
    const pack = buildFactPack({ now: PACK_NOW, notices: [notice({})], patches: { available: true, editions: [patch("2.03.03", "2026-10-25T09:00:00Z")] }, history: history(), board: { available: false }, previous: null });
    expect(editionLead(pack)).toBe("patch");
    expect(editionLead({ ...pack, deltas: { ...pack.deltas, newPatchVersions: [] } })).toBe("notice");
    expect(editionLead({ facts: pack.facts.filter((fact) => !fact.id.startsWith("N")), deltas: { ...pack.deltas, newPatchVersions: [] } })).toBe("patch");
  });
});
