import type { ActivityDay, ActivityHistory } from "@/lib/activityHistory";
import { buildFactPack, type FactPack, type IssueAggregate, type OfficialNotice } from "@/lib/editorials/factPack";
import type { PatchEdition } from "@/lib/patchPublications";

export const PACK_NOW = new Date("2026-10-26T14:05:00Z");

/** Three weeks of complete days ending yesterday, plus today's partial one. */
export function history(players = 20_000, twitch = 3_000): ActivityHistory {
  const days: ActivityDay[] = [];
  const playerCaptures: { capturedAt: string; playerCount: number }[] = [];
  for (let offset = 28; offset >= 0; offset--) {
    const date = new Date(Date.UTC(2026, 9, 26 - offset));
    const day = date.toISOString().slice(0, 10);
    days.push({
      day, playersMin: players - 1000, playersMax: players + 1000, playersAvg: players, playerCaptures: 12,
      twitchAvg: twitch, twitchPeak: twitch * 2, twitchCaptures: 12,
      totalReviews: 100_000 + offset, lifetimePositive: 81, newReviews: 200, newPositive: 150,
    });
    for (let hour = 0; hour < 24; hour += 2) {
      const capturedAt = new Date(date.getTime() + hour * 3_600_000 + 60_000).toISOString();
      if (Date.parse(capturedAt) <= PACK_NOW.getTime()) playerCaptures.push({ capturedAt, playerCount: players });
    }
  }
  return { checkedAt: PACK_NOW.toISOString(), days, playerCaptures, lanes: { players: "ready", twitch: "ready", reviews: "ready" } };
}

export const patch = (version: string, publishedAt: string, fixes: string[] = ["Fixed an issue where the game could crash in certain situations."]): PatchEdition => ({
  version,
  officialUrl: `https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=${version.replace(/\D/g, "")}`,
  publishedAt,
  observedAt: publishedAt,
  totalClaimedFixes: fixes.length,
  fixes: fixes.map((fixText) => ({ fixText, category: null, section: null })),
});

export const NOTICE_URL = "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=134";

export function notice(overrides: Partial<OfficialNotice>): OfficialNotice {
  return {
    id: "announcement-test", publishedAt: "2026-10-25T10:00:00Z", says: ["Pearl Abyss shares a schedule update."],
    source: { label: "Pearl Abyss — schedule update", url: NOTICE_URL }, ...overrides,
  };
}

export function issue(overrides: Partial<IssueAggregate>): IssueAggregate {
  return {
    id: "00000000-0000-4000-8000-0000000000aa", title: "Crash when opening the map", approvedReports: 0,
    publicPosts: 0, postsBySite: {}, officialFixListed: false, stillHappening: false, strength: 1, afterFix: null, ...overrides,
  };
}

export function samplePack(): FactPack {
  return buildFactPack({
    now: PACK_NOW, notices: [],
    patches: { available: true, editions: [patch("2.03.02", "2026-10-24T09:00:00Z", ["Fixed an issue where the map could crash.", "Fixed horses stuck in fences."])] },
    history: history(),
    board: { available: true, patchVersion: "2.03.02", issues: [issue({ approvedReports: 2, publicPosts: 3, postsBySite: { "Steam Community": 3 } })] },
    previous: null,
  });
}
