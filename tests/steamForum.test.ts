import { describe, expect, it, vi } from "vitest";
import { forumAuthorKey } from "@/lib/crypto";
import {
  fetchSteamForumTopics,
  isSteamForumThreadUrl,
  parseSteamForumTime,
  parseSteamForumTopics,
  STEAM_FORUM_URL,
} from "@/lib/automation/steamForum";

const NOW = new Date("2026-10-04T17:30:00.000Z");

function escapeAttribute(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Mirrors the markup Steam serves for one topic row (captured 2026-10-04).
function topicRow(input: {
  id: string;
  title: string;
  preview: string;
  posted: string;
  lastPost: number;
  replies: number;
  sticky?: boolean;
  author?: string;
}): string {
  const author = input.author ?? "PlayerOne";
  const tooltip = escapeAttribute(
    `\t\t\t<div class="topic_hover_text">\n\t\t\t\t${input.preview}\t\t\t</div>\n` +
      `\t\t\t<div class="topic_hover_row">\n\t\t\t\tPosted by: <span class="topic_hover_data">${author}</span>, <span class="">${input.posted}</span>\t\t\t</div>\n` +
      `\t\t\t\t\t\t\t<div class="topic_hover_row">\n\t\t\t\t\tLast post: <span class="topic_hover_data">PlayerTwo</span>, <span class="">10:23am</span>\t\t\t\t</div>`,
  );
  return `<div data-panel="{&quot;clickOnActivate&quot;:&quot;firstChild&quot;}" role="button" class="forum_topic  unread${input.sticky ? " sticky" : ""}" id="forum_General_45343476_${input.id}"  data-gidforumtopic="${input.id}" data-tooltip-forum="${tooltip}">
\t<a class="forum_topic_overlay" href="${STEAM_FORUM_URL}${input.id}/">

\t</a>
\t\t\t<div class="forum_topic_details ">
\t\t\t<div class="forum_topic_reply_count">
\t\t\t\t<img src="https://community.fastly.steamstatic.com/public/images/skin_1/forum_icon_Comments.png"> ${input.replies}\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t<div class="forum_topic_lastpost" title="October 4, 2026 @ 5:23:25 pm +00" data-timestamp="${input.lastPost}">
\t\t\t\t\t3 minutes ago\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t<div class="forum_topic_name ">
\t\t\t\t\t\t\t\t\t\t\t\t\t${input.title}\t\t\t\t\t\t</div>
\t\t\t<div class="forum_topic_op">
\t\t\t${author}\t\t\t\t\t</div>
\t\t<div style="clear: both;"></div>
</div>
`;
}

const unix = (iso: string) => Date.parse(iso) / 1000;

describe("parseSteamForumTime", () => {
  it.each([
    ["9:15am", "2026-10-04T09:15:00.000Z"],
    ["12:05am", "2026-10-04T00:05:00.000Z"],
    ["12:40pm", "2026-10-04T12:40:00.000Z"],
    ["Oct 3 @ 11:18pm", "2026-10-03T23:18:00.000Z"],
    ["Mar 23 @ 9:56am", "2026-03-23T09:56:00.000Z"],
    ["Dec 30, 2025 @ 4:02pm", "2025-12-30T16:02:00.000Z"],
    // A yearless date more than a day ahead of the fetch is last year's.
    ["Dec 30 @ 4:02pm", "2025-12-30T16:02:00.000Z"],
  ])("reads %j as UTC", (value, expected) => {
    expect(parseSteamForumTime(value, NOW)).toBe(expected);
  });

  it.each(["", "3 minutes ago", "Foo 3 @ 1:00pm", "Feb 30 @ 1:00pm", "Oct 3 @ 13:61pm", "Oct 4 @ 13:05pm", "0:05am", "Oct 4 @ 0:05am"])("rejects %j", (value) => {
    expect(parseSteamForumTime(value, NOW)).toBeNull();
  });
});

describe("parseSteamForumTopics", () => {
  it("reads the thread title, opening-post preview, dates and reply count without author names", () => {
    const html = topicRow({
      id: "582810101152245250",
      title: "Game crashes after the 2.03.02 hotfix &amp; won&#39;t launch",
      preview: "Since the hotfix the game crashes on launch.\nVerified files, no change...",
      posted: "Oct 3 @ 11:18pm",
      lastPost: unix("2026-10-04T17:23:25.000Z"),
      replies: 7,
    });

    const [topic] = parseSteamForumTopics(html, NOW);

    expect(topic).toEqual({
      topicId: "582810101152245250",
      url: `${STEAM_FORUM_URL}582810101152245250/`,
      title: "Game crashes after the 2.03.02 hotfix & won't launch",
      preview: "Since the hotfix the game crashes on launch. Verified files, no change...",
      postedAt: "2026-10-03T23:18:00.000Z",
      postedAtStatus: "ok",
      postedText: "Oct 3 @ 11:18pm",
      lastPostAt: "2026-10-04T17:23:25.000Z",
      replyCount: 7,
      sticky: false,
      authorKey: null,
    });
    expect(JSON.stringify(topic)).not.toMatch(/PlayerOne|PlayerTwo/);
  });

  it("hands only the opening post's author to the keyer and keeps no name", () => {
    const keyer = vi.fn((name: string) => forumAuthorKey(name, "test-secret"));
    const html = [
      topicRow({ id: "41", title: "Crash after hotfix", preview: "Posted by: Someone Else, Oct 1 @ 1:00pm", posted: "Oct 3 @ 11:18pm", lastPost: unix("2026-10-04T17:00:00Z"), replies: 2 }),
      topicRow({ id: "42", title: "Map crash", preview: "Map crashes.", posted: "Oct 3 @ 9:00pm", lastPost: unix("2026-10-04T16:00:00Z"), replies: 1, author: "Desert &amp; Rider" }),
      topicRow({ id: "43", title: "Map crash too", preview: "Same here.", posted: "Oct 3 @ 8:00pm", lastPost: unix("2026-10-04T15:00:00Z"), replies: 0 }),
    ].join("");

    const topics = parseSteamForumTopics(html, NOW, keyer);

    expect(keyer.mock.calls.map(([name]) => name)).toEqual(["PlayerOne", "Desert & Rider", "PlayerOne"]);
    expect(topics.map((topic) => topic.authorKey)).toEqual([
      forumAuthorKey("PlayerOne", "test-secret"),
      forumAuthorKey("Desert & Rider", "test-secret"),
      forumAuthorKey("PlayerOne", "test-secret"),
    ]);
    expect(JSON.stringify(topics)).not.toMatch(/PlayerOne|PlayerTwo|Desert & Rider/);
  });

  it("reads the opening time from the metadata row even when the preview quotes \"Posted by:\"", () => {
    const html = topicRow({
      id: "31",
      title: "Crash after hotfix",
      preview: "Posted by: someone, Oct 1 @ 1:00pm in another thread, same crash here.",
      posted: "Oct 3 @ 11:18pm",
      lastPost: unix("2026-10-04T17:00:00Z"),
      replies: 2,
    });

    const [topic] = parseSteamForumTopics(html, NOW);

    expect(topic).toMatchObject({ postedAt: "2026-10-03T23:18:00.000Z", postedAtStatus: "ok", postedText: "Oct 3 @ 11:18pm" });
  });

  it("keeps a malformed opening time apart from a missing one", () => {
    const html = [
      topicRow({ id: "21", title: "Crash", preview: "c", posted: "Foo 3 @ 1:00pm", lastPost: unix("2026-10-04T17:00:00Z"), replies: 1 }),
      topicRow({ id: "22", title: "Crash", preview: "c", posted: "", lastPost: unix("2026-10-04T17:00:00Z"), replies: 1 }),
    ].join("");

    const topics = parseSteamForumTopics(html, NOW);

    expect(topics.map(({ topicId, postedAt, postedAtStatus, postedText }) => ({ topicId, postedAt, postedAtStatus, postedText }))).toEqual([
      { topicId: "21", postedAt: null, postedAtStatus: "malformed", postedText: "Foo 3 @ 1:00pm" },
      { topicId: "22", postedAt: null, postedAtStatus: "missing", postedText: "" },
    ]);
  });

  it("marks pinned threads and skips rows that are not this game's forum", () => {
    const html = [
      topicRow({ id: "1", title: "PINNED: Notice", preview: "Notice.", posted: "Aug 25 @ 11:33pm", lastPost: unix("2026-09-26T04:53:46Z"), replies: 48, sticky: true }),
      topicRow({ id: "2", title: "Stutter", preview: "Stutter.", posted: "9:15am", lastPost: unix("2026-10-04T17:00:00Z"), replies: 1 })
        .replace(STEAM_FORUM_URL, "https://steamcommunity.com/app/1/discussions/0/"),
    ].join("");

    const topics = parseSteamForumTopics(html, NOW);

    expect(topics.map((topic) => [topic.topicId, topic.sticky])).toEqual([["1", true]]);
  });
});

describe("isSteamForumThreadUrl", () => {
  it("accepts threads in the game's own forums and nothing else on the domain", () => {
    for (const url of [
      `${STEAM_FORUM_URL}600000000000000001`,
      `${STEAM_FORUM_URL}600000000000000001/`,
      "https://steamcommunity.com/app/3321460/discussions/7/600000000000000002?ctp=3",
      "https://www.steamcommunity.com/app/3321460/discussions/0/600000000000000003",
    ]) expect(isSteamForumThreadUrl(url)).toBe(true);
    for (const url of [
      STEAM_FORUM_URL,
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3500000000",
      "https://steamcommunity.com/app/1000000/discussions/0/600000000000000004",
      "https://steamcommunity.com/games/3321460/announcements/detail/600000000000000005",
      "https://steamcommunity.com/app/3321460/discussions/search/?q=crash",
      "https://example.com/app/3321460/discussions/0/600000000000000006",
      "not a url",
      null,
    ]) expect(isSteamForumThreadUrl(url)).toBe(false);
  });
});

describe("fetchSteamForumTopics", () => {
  const page = (rows: string[]) => new Response(`<html><body>${rows.join("")}</body></html>`, { status: 200 });

  it("reads pages in UTC until threads go quiet before the lookback and drops pinned threads", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (!url.searchParams.has("fp")) {
        return page([
          topicRow({ id: "10", title: "Pinned", preview: "p", posted: "Aug 25 @ 1:00pm", lastPost: unix("2026-09-01T00:00:00Z"), replies: 1, sticky: true }),
          topicRow({ id: "11", title: "Crash", preview: "c", posted: "9:15am", lastPost: unix("2026-10-04T17:00:00Z"), replies: 2 }),
        ]);
      }
      if (url.searchParams.get("fp") === "2") {
        return page([
          topicRow({ id: "12", title: "Stutter", preview: "s", posted: "Oct 2 @ 1:00pm", lastPost: unix("2026-10-04T15:00:00Z"), replies: 3 }),
          topicRow({ id: "13", title: "Old", preview: "o", posted: "Oct 1 @ 1:00pm", lastPost: unix("2026-10-04T13:00:00Z"), replies: 4 }),
        ]);
      }
      throw new Error(`unexpected page ${url}`);
    });

    const topics = await fetchSteamForumTopics({ since: new Date("2026-10-04T14:30:00Z"), now: NOW, maxPages: 3, fetchImpl });

    expect(topics.map((topic) => topic.topicId)).toEqual(["11", "12"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ cookie: "timezoneOffset=0,0" });
  });

  it("stops at the page cap", async () => {
    const fetchImpl = vi.fn(async () =>
      page([topicRow({ id: String(Math.random()).slice(2), title: "Crash", preview: "c", posted: "9:15am", lastPost: unix("2026-10-04T17:00:00Z"), replies: 1 })]),
    );

    await fetchSteamForumTopics({ since: new Date("2026-10-04T14:30:00Z"), now: NOW, maxPages: 2, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails on an error status or a first page with no readable topics", async () => {
    await expect(
      fetchSteamForumTopics({ since: NOW, now: NOW, maxPages: 1, fetchImpl: async () => new Response("", { status: 503 }) }),
    ).rejects.toThrow("Steam forum request failed (503)");
    await expect(
      fetchSteamForumTopics({ since: NOW, now: NOW, maxPages: 1, fetchImpl: async () => page([]) }),
    ).rejects.toThrow("Steam forum page had no readable topics");
  });
});
