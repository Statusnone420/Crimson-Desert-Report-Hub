import { describe, expect, it, vi } from "vitest";
import { fetchLatestSteamPatchNote, isNewerPatchVersion, parseSteamPatchNews, STEAM_PATCH_NEWS_URL } from "@/lib/steamPatchNews";

// The live shape: official announcements in BBCode, newest first, with nested lists.
const patchBody = "[p]Fellow Greymanes,[/p][p][b]Patch Details[/b][/p][hr][/hr][list]" +
  "[*][p]Fixed an issue where the map would not open after a cutscene.[/p][/*]" +
  "[*][p]Improved the skill system.[/p][list][*][p]Added a new skill resource.[/p][/*][/list][/*]" +
  "[*][p]Fixed an issue where a quest marker &quot;The Pot&quot; would not appear.[/p][/*][/list]" +
  "[p][b]Known Issues[/b][/p][list][*][p]For known issues, see the notice below:[/p][list][*][p]" +
  "[url=\"https://crimsondesert.pearlabyss.com/News/Notice/Detail?_boardNo=68\"]Known Issues[/url][/p][/*][/list][/*][/list]";
const item = (overrides: Record<string, unknown>) => ({
  gid: "1844751498217378", title: "Patch Notes Version 2.03.02", contents: patchBody, date: 1790138908,
  feedname: "steam_community_announcements", feed_type: 1, appid: 3321460, ...overrides,
});
const payload = (items: unknown[]) => ({ appnews: { appid: 3321460, newsitems: items, count: items.length } });

describe("Steam patch announcements", () => {
  it("reads the newest versioned announcement as an official patch note with its claimed fixes", () => {
    const note = parseSteamPatchNews(payload([
      item({ gid: "1846018067929243", title: "Vote for Crimson Desert at the Golden Joystick Awards 2026!", date: 1791457317 }),
      item({}),
      item({ gid: "1844115010501496", title: "Patch Notes Version 2.03.01", date: 1789999733 }),
    ]));

    expect(note).toEqual({
      boardNo: "steam-1844751498217378",
      title: "Patch Notes Version 2.03.02",
      patchVersion: "2.03.02",
      officialUrl: "https://store.steampowered.com/news/app/3321460/view/1844751498217378",
      publishedAt: "2026-09-23T04:48:28.000Z",
      summary: null,
      claimedFixes: [
        { text: "Fixed an issue where the map would not open after a cutscene.", section: null },
        { text: "Fixed an issue where a quest marker \"The Pot\" would not appear.", section: null },
      ],
      claimedFixTotal: 2,
    });
  });

  it("chooses the highest version, then the newest post, and ignores other feeds and malformed items", () => {
    const note = parseSteamPatchNews(payload([
      item({ gid: "1", title: "Patch Notes Version 9.99.00", feedname: "pcgamer" }),
      item({ gid: "2", title: "Patch Notes Version 9.98.00", date: 0 }),
      item({ gid: "not-a-number", title: "Patch Notes Version 9.97.00" }),
      item({ gid: "3", title: "Patch Notes Version 2.10.00", date: 100 }),
      item({ gid: "4", title: "Patch Notes Version 2.9.00", date: 300 }),
      item({ gid: "5", title: "Patch Notes Version 2.10.00 (All Platforms Hotfix)", date: 200 }),
      null,
    ]));
    expect(note).toMatchObject({ boardNo: "steam-5", patchVersion: "2.10.00" });
  });

  it("returns null without patch notes and throws on a malformed response", () => {
    expect(parseSteamPatchNews(payload([item({ title: "Charting the Unknown: Release Date Update" })]))).toBeNull();
    expect(() => parseSteamPatchNews({ appnews: {} })).toThrow("Steam patch news response was malformed");
    expect(() => parseSteamPatchNews(null)).toThrow("Steam patch news response was malformed");
  });

  it("asks only the official announcement feed and surfaces HTTP failures", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload([item({})])) }));
    await expect(fetchLatestSteamPatchNote({ fetcher })).resolves.toMatchObject({ patchVersion: "2.03.02" });
    expect(fetcher).toHaveBeenCalledWith(STEAM_PATCH_NEWS_URL, expect.objectContaining({ cache: "no-store" }));
    const url = new URL(STEAM_PATCH_NEWS_URL);
    expect(url.origin + url.pathname).toBe("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ appid: "3321460", feeds: "steam_community_announcements" });

    fetcher.mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    await expect(fetchLatestSteamPatchNote({ fetcher })).rejects.toThrow("Steam patch news fetch failed: 503");
  });

  it("compares patch versions numerically", () => {
    expect(isNewerPatchVersion("2.10.00", ["2.9.00", "2.09.01", null])).toBe(true);
    expect(isNewerPatchVersion("2.03.02", ["2.03.02"])).toBe(false);
    expect(isNewerPatchVersion("2.03.02", ["2.03.10"])).toBe(false);
    expect(isNewerPatchVersion("1.14", ["1.13.09"])).toBe(true);
  });
});
