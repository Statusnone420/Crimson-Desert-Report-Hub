export type EditorialSource = {
  label: string;
  url: string;
};

export type EditorialArticle = {
  slug: string;
  path: `/articles/${string}`;
  section: string;
  patchVersion?: string;
  title: string;
  searchTitle: string;
  description: string;
  publishedAt: string;
  sourceNote: string;
  heroImage: {
    src: `/${string}`;
    width: number;
    height: number;
    alt: string;
  };
  shareImage?: {
    src: `/${string}`;
    width: number;
    height: number;
    alt: string;
  };
  sources: readonly EditorialSource[];
};

export const chartingTheUnknown = {
  slug: "charting-the-unknown",
  path: "/articles/charting-the-unknown",
  section: "Expansion report",
  title: "Charting the Unknown launches October 15",
  searchTitle: "Crimson Desert: Charting the Unknown launches October 15",
  description:
    "The Crimson Desert expansion adds ships, underwater exploration and housing changes. Pearl Abyss lists an October 15 launch at 6 p.m. Eastern.",
  publishedAt: "2026-09-05T00:00:00Z",
  sourceNote: "Based on Pearl Abyss’s September 3 announcement and official DLC overview.",
  heroImage: {
    src: "/official/coast.jpg",
    width: 1920,
    height: 1180,
    alt: "A rider overlooking the sea, rocky islands and a sailing ship",
  },
  sources: [
    {
      label: "Pearl Abyss — pre-orders and release times",
      url: "https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=129",
    },
    {
      label: "Pearl Abyss — Charting the Unknown overview",
      url: "https://crimsondesert.pearlabyss.com/en-us/Game/DLC/charting-the-unknown",
    },
  ],
} as const satisfies EditorialArticle;

export const patch20200 = {
  slug: "patch-2-02-00",
  path: "/articles/patch-2-02-00",
  section: "Patch report",
  patchVersion: "2.02.00",
  title: "Crimson Desert patch 2.02.00 adds Mac cross-save",
  searchTitle: "Crimson Desert patch 2.02.00 adds Mac cross-save",
  description:
    "Crimson Desert’s September 11 update adds Mac cross-save and lists fixes for quests, stored items and a DLSS Frame Generation startup crash.",
  publishedAt: "2026-09-11T07:30:00Z",
  sourceNote: "Based on Pearl Abyss’s patch notes, expansion pages and cross-save guide.",
  heroImage: {
    src: "/official/patch-2-02-00.png",
    width: 923,
    height: 522,
    alt: "Crimson Desert Enhanced patch artwork: an armored warrior faces a stone gateway breaking apart",
  },
  shareImage: {
    src: "/share/patch-2-02-00.png",
    width: 1200,
    height: 630,
    alt: "Crimson Desert Report Hub newspaper: Patch 2.02.00 adds Mac cross-save. Quest, storage and stability fixes, with official Pearl Abyss artwork.",
  },
  sources: [
    {
      label: "Pearl Abyss — Patch Notes Version 2.02.00 and platform rollout",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=130",
    },
    {
      label: "Pearl Abyss — Charting the Unknown announcement and release times",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
    },
    {
      label: "Pearl Abyss Account — Cross-Save information",
      url: "https://account.pearlabyss.com/en-US/Member/Linking/CrimsonDesert",
    },
    {
      label: "Pearl Abyss — Charting the Unknown feature overview",
      url: "https://crimsondesert.pearlabyss.com/en-us/Game/DLC/charting-the-unknown",
    },
  ],
} as const satisfies EditorialArticle;

// Published original reports, newest first. Shared by the front page, News and feeds.
export const editorialArticles = [patch20200, chartingTheUnknown] as const;
