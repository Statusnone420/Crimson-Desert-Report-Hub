import { describe, expect, it, vi } from "vitest";
import { evaluateCurrentPatchEligibility } from "@/lib/automation/eligibility";
import { withSteamThreadReplies } from "@/lib/automation/run";
import { fetchSteamThreadLatestReply, parseSteamThreadPage } from "@/lib/automation/steamForum";

const THREAD = "https://steamcommunity.com/app/3321460/discussions/0/805720165777093621";
const NOW = new Date("2026-10-18T12:00:00.000Z");
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// Markup modeled on a real thread page: a paging summary whose total sits in a
// span, and one Unix data-timestamp per post.
function threadPage(shown: [number, number, number], times: string[]): string {
  return [
    `<div class="forum_paging_summary ellipsis"> Showing ${shown[0]} - ${shown[1]} of <span id="commentthread_ForumTopic_1_totalcount">${shown[2]}</span> comments </div>`,
    ...times.map((iso, index) =>
      `<div class="${index === 0 ? "date " : ""}commentthread_comment_timestamp" title="x" data-timestamp="${seconds(iso)}">x</div>`),
  ].join("\n");
}

function fetchPages(pages: Record<string, string | number>) {
  return vi.fn(async (input: string | URL | Request) => {
    const page = new URL(String(input)).searchParams.get("ctp") ?? "1";
    const body = pages[page];
    return typeof body === "number" ? new Response("", { status: body }) : new Response(body ?? "", { status: body ? 200 : 404 });
  });
}

describe("reading a Steam thread page", () => {
  it("finds the newest post and the reply count", () => {
    expect(parseSteamThreadPage(threadPage([1, 15, 71], ["2026-03-20T00:23:12Z", "2026-03-20T00:25:56Z"]))).toEqual({
      latestMs: Date.parse("2026-03-20T00:25:56Z"),
      shown: { from: 1, to: 15, total: 71 },
    });
  });

  it("reports nothing it cannot read", () => {
    expect(parseSteamThreadPage("<html>no thread here</html>")).toEqual({ latestMs: null, shown: null });
  });
});

describe("the latest reply in a Steam thread", () => {
  it("reads the last page of a long thread", async () => {
    const fetchImpl = fetchPages({
      1: threadPage([1, 15, 71], ["2026-03-20T00:23:12Z", "2026-03-20T03:33:00Z"]),
      5: threadPage([61, 71, 71], ["2026-10-01T10:00:00Z", "2026-10-18T06:57:00Z"]),
    });
    await expect(fetchSteamThreadLatestReply(THREAD, { now: NOW, fetchImpl })).resolves.toBe("2026-10-18T06:57:00.000Z");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get("ctp")).toBe("5");
  });

  it("reads one page when the thread fits on it", async () => {
    const fetchImpl = fetchPages({ 1: threadPage([1, 1, 1], ["2026-07-10T22:19:00Z", "2026-10-17T15:21:00Z"]) });
    await expect(fetchSteamThreadLatestReply(THREAD, { now: NOW, fetchImpl })).resolves.toBe("2026-10-17T15:21:00.000Z");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps the first page's answer when the last page fails", async () => {
    const fetchImpl = fetchPages({ 1: threadPage([1, 15, 71], ["2026-03-20T03:33:00Z"]), 5: 503 });
    await expect(fetchSteamThreadLatestReply(THREAD, { now: NOW, fetchImpl })).resolves.toBe("2026-03-20T03:33:00.000Z");
  });

  it("returns null for a refused page, a non-thread URL, or only future times", async () => {
    await expect(fetchSteamThreadLatestReply(THREAD, { now: NOW, fetchImpl: fetchPages({ 1: 503 }) })).resolves.toBeNull();
    const untouched = fetchPages({});
    await expect(fetchSteamThreadLatestReply("https://store.steampowered.com/app/3321460", { now: NOW, fetchImpl: untouched })).resolves.toBeNull();
    expect(untouched).not.toHaveBeenCalled();
    const future = fetchPages({ 1: threadPage([1, 1, 1], ["2026-10-25T00:00:00Z"]) });
    await expect(fetchSteamThreadLatestReply(THREAD, { now: NOW, fetchImpl: future })).resolves.toBeNull();
  });
});

type Candidate = Parameters<typeof withSteamThreadReplies>[0][number];

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    source: "web_search",
    id: THREAD,
    title: "Time to count as holding button is extreme short",
    body: "The hold time is extremely short.",
    url: THREAD,
    observedAt: NOW.toISOString(),
    sourceDomain: "steamcommunity.com",
    sourcePublishedAt: "2026-07-10T22:19:00.000Z",
    ...overrides,
  } as Candidate;
}

describe("checking stale-looking Steam threads before screening", () => {
  it("adds the latest reply to a stale-looking thread", async () => {
    const readLatestReply = vi.fn(async () => "2026-10-17T15:21:00.000Z");
    const onCheck = vi.fn();
    const [checked] = await withSteamThreadReplies([candidate()], { looksStale: () => true, readLatestReply, onCheck });
    expect(checked.sourceActiveAt).toBe("2026-10-17T15:21:00.000Z");
    expect(onCheck).toHaveBeenCalledWith(true);

    // The date gate then stores it as a private lead, never as current evidence.
    expect(evaluateCurrentPatchEligibility(
      { title: checked.title, snippet: checked.body, sourcePublishedAt: checked.sourcePublishedAt, sourceActiveAt: checked.sourceActiveAt },
      { version: "2.03.02", publishedAt: "2026-09-23T02:00:00.000Z" },
    )).toEqual({ canStore: true, canPublish: false, reason: "active_after_patch" });
  });

  it("leaves everything else alone", async () => {
    const readLatestReply = vi.fn(async () => "2026-10-17T15:21:00.000Z");
    const input = [
      candidate({ url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/x/", id: "r" }),
      candidate({ sourceActiveAt: "2026-10-01T00:00:00.000Z" }),
      candidate({ source: "steam_review", url: "https://store.steampowered.com/appreviews/3321460" }),
    ];
    const out = await withSteamThreadReplies(input, { looksStale: () => true, readLatestReply });
    expect(out).toEqual(input);
    const fresh = await withSteamThreadReplies([candidate()], { looksStale: () => false, readLatestReply });
    expect(fresh[0].sourceActiveAt).toBeUndefined();
    expect(readLatestReply).not.toHaveBeenCalled();
  });

  it("stops at the per-scan cap, reads each thread once, and survives a failed read", async () => {
    const threads = Array.from({ length: 4 }, (_, index) => candidate({ url: `${THREAD.slice(0, -3)}${100 + index}` }));
    const readLatestReply = vi.fn(async (url: string) => {
      if (url.endsWith("101")) throw new Error("offline");
      return "2026-10-17T15:21:00.000Z";
    });
    const onCheck = vi.fn();
    const out = await withSteamThreadReplies([...threads, threads[0]], { looksStale: () => true, readLatestReply, maxChecks: 3, onCheck });
    expect(readLatestReply).toHaveBeenCalledTimes(3);
    // The repeated first thread reuses its earlier read instead of spending a check.
    expect(out.map((item) => item.sourceActiveAt ?? null)).toEqual([
      "2026-10-17T15:21:00.000Z", null, "2026-10-17T15:21:00.000Z", null, "2026-10-17T15:21:00.000Z",
    ]);
    expect(onCheck.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("treats a thread's comment pages as the same thread", async () => {
    const readLatestReply = vi.fn(async () => "2026-10-17T15:21:00.000Z");
    const out = await withSteamThreadReplies(
      [candidate(), candidate({ url: `${THREAD}/?ctp=2` }), candidate({ url: `${THREAD.slice(0, -3)}999` })],
      { looksStale: () => true, readLatestReply, maxChecks: 2 },
    );
    expect(readLatestReply).toHaveBeenCalledTimes(2);
    expect(out.every((item) => item.sourceActiveAt === "2026-10-17T15:21:00.000Z")).toBe(true);
  });
});
