export type EditorialSource = {
  label: string;
  url: string;
};

export type PatchCatchUp = {
  kind: "update" | "hotfix";
  // Official notice time and first Hub availability are deliberately separate.
  publishedAt: string;
  availableAt: string;
  title: string;
  summary: string;
  highlights: readonly [string, ...string[]];
};

type EditorialArticleBase = {
  publicationKind?: "rundown";
  slug: string;
  path: `/articles/${string}`;
  section: string;
  title: string;
  searchTitle: string;
  description: string;
  publishedAt: string;
  // Last editorial revision; feeds use it so readers see edits without moving publishedAt.
  updatedAt?: string;
  // A named byline. Feeds fall back to the site name when it is absent.
  author?: string;
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
  sources: readonly [EditorialSource, ...EditorialSource[]];
};

// A published patch report cannot omit its reviewed Catch Up content.
export type EditorialArticle = EditorialArticleBase & (
  | { patchVersion: string; catchUp: PatchCatchUp }
  | { patchVersion?: never; catchUp?: Omit<PatchCatchUp, "kind"> & { kind: "announcement" } }
);

export const chartingTheUnknown = {
  slug: "charting-the-unknown",
  path: "/articles/charting-the-unknown",
  section: "Expansion report",
  title: "Charting the Unknown: original launch announcement",
  searchTitle: "Crimson Desert: Charting the Unknown — original launch announcement",
  description:
    "The original expansion reveal covered ships, underwater exploration and housing changes. Pearl Abyss later moved the announced October 15 launch to October 29.",
  publishedAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-10-06T01:05:00Z",
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
  catchUp: {
    publishedAt: "2026-09-11T05:30:00Z",
    availableAt: "2026-09-11T13:49:21.448Z",
    kind: "update",
    title: "Mac cross-save and fixes for progress and storage",
    summary: "Patch 2.02 adds Mac cross-save. Pearl Abyss also lists fixes for housing, quest progress, missing stored items and a crash when starting a new game.",
    highlights: [
      "The notes target housing unlocks at Howling Hill Camp and liberation at Thornbriar Fortress.",
      "Other listed fixes concern Trade Goods Storage items and the letter in The Words of Alustin.",
      "The startup crash fix applies to a new game with DLSS Frame Generation enabled.",
    ],
  },
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

export const patch20300 = {
  slug: "patch-2-03-00",
  path: "/articles/patch-2-03-00",
  section: "Patch report",
  patchVersion: "2.03.00",
  catchUp: {
    publishedAt: "2026-09-18T01:00:00Z",
    availableAt: "2026-09-18T05:14:45Z",
    kind: "update",
    title: "Photo Mode and Water Stride expand",
    summary: "Patch 2.03 adds camera and movement options alongside graphics changes and listed fixes.",
    highlights: [
      "Photo Mode gains finer camera control with Precise Movement.",
      "Water Stride now allows jumping and, with Vaporwalker equipped, sliding.",
      "DLSS Ray Reconstruction uses a newer transformer model. The notes give no frame-rate figures.",
    ],
  },
  title: "Crimson Desert keeps weekly patches coming with 2.03.00",
  searchTitle: "Crimson Desert keeps weekly patches coming with 2.03.00",
  description:
    "Patch 2.03.00 updates DLSS Ray Reconstruction as Crimson Desert’s weekly patches continue, with Charting the Unknown less than a month away.",
  publishedAt: "2026-09-18T05:14:45Z",
  sourceNote: "Based on Pearl Abyss’s September patch notes and expansion announcement.",
  heroImage: {
    src: "/official/patch-2-03-00.png",
    width: 923,
    height: 522,
    alt: "Crimson Desert Enhanced patch artwork: two armored fighters clash in tall grass",
  },
  shareImage: {
    src: "/share/patch-2-03-00.png",
    width: 1200,
    height: 630,
    alt: "Crimson Desert Report Hub: Patch 2.03.00. Still getting weekly patches. A DLSS update ahead of the DLC, with official Pearl Abyss artwork.",
  },
  sources: [
    {
      label: "Pearl Abyss — Patch Notes Version 2.03.00 and platform rollout",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=131",
    },
    {
      label: "Pearl Abyss — September 11 patch 2.02.00",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=130",
    },
    {
      label: "Pearl Abyss — September 4 patch 2.01.00",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=128",
    },
    {
      label: "Pearl Abyss — Charting the Unknown release schedule",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
    },
  ],
} as const satisfies EditorialArticle;

const delayArtwork = {
  src: "/official/charting-the-unknown-delay.webp",
  width: 1920,
  height: 1080,
  alt: "Pearl Abyss’s Charting the Unknown release-date announcement, with a diver beneath the waves and the new October 29 date",
} as const;

export const chartingTheUnknownDelay = {
  slug: "charting-the-unknown-delay",
  path: "/articles/charting-the-unknown-delay",
  section: "Expansion news & opinion",
  title: "Charting the Unknown delayed two weeks to October 29",
  searchTitle: "Crimson Desert: Charting the Unknown delayed to October 29",
  description: "Pearl Abyss postpones the Crimson Desert expansion for more polish and stability work. The revised launch is October 29 at 6 p.m. Eastern.",
  publishedAt: "2026-09-30T13:30:00Z",
  sourceNote: "Based on Pearl Abyss’s September 30 release-date update and revised expansion announcement. Includes an editorial opinion.",
  heroImage: delayArtwork,
  shareImage: delayArtwork,
  catchUp: {
    kind: "announcement",
    publishedAt: "2026-09-30T10:20:00Z",
    availableAt: "2026-09-30T13:30:00Z",
    title: "Charting the Unknown moves to October 29",
    summary: "Charting the Unknown moves to October 29. Pearl Abyss postpones the expansion by two weeks for further polish and stability work.",
    highlights: [
      "The revised launch is October 29 at 22:00 UTC, or 6 p.m. Eastern.",
      "Pearl Abyss says it needs additional development time to refine the content.",
      "The Mac App Store version remains excluded from launch in the revised announcement.",
    ],
  },
  sources: [
    {
      label: "Pearl Abyss — September 30 release-date update",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=134",
    },
    {
      label: "Pearl Abyss — September 3 pre-order announcement, revised September 30",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
    },
    {
      label: "Crimson Desert — official September 30 announcement on X",
      url: "https://x.com/crimsondesert_/status/2105236803125149951",
    },
    {
      label: "Pearl Abyss — Charting the Unknown feature overview",
      url: "https://crimsondesert.pearlabyss.com/en-US/Game/DLC/charting-the-unknown",
    },
  ],
} as const satisfies EditorialArticle;

// Published original reports, newest first. Shared by the front page, News and feeds.
export const editorialArticles = [chartingTheUnknownDelay, patch20300, patch20200, chartingTheUnknown] as const satisfies readonly EditorialArticle[];
