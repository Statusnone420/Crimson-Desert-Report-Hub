export type EditorialSource = {
  label: string;
  url: string;
};

export type EditorialArticle = {
  slug: string;
  path: `/articles/${string}`;
  topicPath: `/topics/${string}`;
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
  sources: readonly EditorialSource[];
};

export const chartingTheUnknown = {
  slug: "charting-the-unknown",
  path: "/articles/charting-the-unknown",
  topicPath: "/topics/charting-the-unknown",
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

export const editorialArticles = [chartingTheUnknown] as const;
