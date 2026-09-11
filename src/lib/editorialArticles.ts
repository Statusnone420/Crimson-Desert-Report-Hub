export type EditorialSource = {
  label: string;
  url: string;
};

export type EditorialArticle = {
  slug: string;
  path: `/articles/${string}`;
  section: string;
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
  title: "Beyond Pywel’s familiar shores",
  searchTitle: "Charting the Unknown: Release date and features",
  description:
    "What Pearl Abyss has confirmed about Charting the Unknown: its October 15 release, new islands, underwater exploration, and expanded housing.",
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
  title: "Patch 2.02.00 adds Mac cross-save",
  searchTitle: "Crimson Desert 2.02.00 adds Mac cross-save",
  description:
    "Pearl Abyss follows the Charting the Unknown reveal with Mac cross-save and welcome fixes for a startup crash, blocked quests and missing items.",
  publishedAt: "2026-09-11T07:30:00Z",
  sourceNote: "Based on Pearl Abyss’s patch notes, expansion pages and current cross-save account guidance.",
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
