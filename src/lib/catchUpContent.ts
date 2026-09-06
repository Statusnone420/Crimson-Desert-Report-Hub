export type CatchUpMilestone = {
  id: string;
  publishedAt: string;
  patch?: string;
  kind: "update" | "hotfix" | "announcement";
  title: string;
  summary: string;
  highlights: string[];
  image?: { src: string; alt: string; width: number; height: number };
  source: { label: string; url: string };
  related?: { label: string; url: string }[];
};

// A curated recent edition. Times are the official notices' publication times in UTC.
// Both August 28 hotfix notices display 00:00; their version order breaks that tie.
export const CATCH_UP_MILESTONES: readonly CatchUpMilestone[] = [
  {
    id: "enhanced-2-00-00",
    publishedAt: "2026-08-25T18:20:00Z",
    patch: "2.00.00",
    kind: "update",
    title: "Enhanced brings story and skill changes",
    summary: "The free Enhanced update adds story scenes, more language options and a reworked skill system. Existing owners receive it by updating the base game.",
    highlights: [
      "The first launch after this update resets existing skills and refunds the resources spent learning them.",
      "Spending Abyss Artifacts on one character grants Abyss Links to the others; skill resets are now separate for each character.",
      "Story progress unlocks eight additional Kliff skills. The update also adds five voice languages and Arabic menus and subtitles.",
    ],
    image: {
      src: "/official/content.jpg",
      alt: "A warrior overlooking a riverside settlement in an official image",
      width: 3840,
      height: 2160,
    },
    source: {
      label: "Pearl Abyss · 2.00.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=123",
    },
    related: [
      {
        label: "What the free Enhanced update includes",
        url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=125",
      },
    ],
  },
  {
    id: "hotfix-2-00-01",
    publishedAt: "2026-08-28T00:00:00Z",
    patch: "2.00.01",
    kind: "hotfix",
    title: "An early hotfix targets text and performance",
    summary: "Pearl Abyss lists fixes for Arabic text, frame-rate drops and some Steam Mac launch failures after Enhanced.",
    highlights: [
      "Arabic text that appeared incorrectly is addressed in the notes.",
      "The notes target frame-rate drops in some situations.",
      "Steam Mac launch failures on certain macOS setups are also listed.",
    ],
    source: {
      label: "Pearl Abyss · 2.00.01 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=126",
    },
  },
  {
    id: "hotfix-2-00-02",
    publishedAt: "2026-08-28T00:00:00Z",
    patch: "2.00.02",
    kind: "hotfix",
    title: "Quarry controls and horse travel get a follow-up",
    summary: "A second hotfix lists fixes for unresponsive crane controls and unwanted dismounts. Its cutscene lip-sync changes are described as partial improvements.",
    highlights: [
      "The small crane at Karin Quarry is the control fix named in the notes.",
      "The horse fix concerns collisions with wandering merchants.",
      "Lip-sync work covers certain cutscenes, not every conversation.",
    ],
    source: {
      label: "Pearl Abyss · 2.00.02 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=127",
    },
  },
  {
    id: "charting-the-unknown-announcement",
    publishedAt: "2026-09-03T14:00:00Z",
    kind: "announcement",
    title: "Charting the Unknown is scheduled for October 15",
    summary: "Pearl Abyss publishes the expansion’s launch schedule and pre-order details. The official overview describes ship travel, underwater exploration and expanded housing.",
    highlights: [
      "The announced launch is October 15, 2026 at 10 pm UTC, or 6 pm Eastern.",
      "The expansion overview includes offshore islands and facilities to rent and manage.",
      "The Mac App Store version will not be available at launch.",
    ],
    image: {
      src: "/official/coast.jpg",
      alt: "A rider overlooking the sea, islands and a ship in an official image",
      width: 1920,
      height: 1180,
    },
    source: {
      label: "Pearl Abyss · Expansion release announcement",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=129",
    },
    related: [
      {
        label: "Official expansion overview",
        url: "https://crimsondesert.pearlabyss.com/en-US/Game/DLC/charting-the-unknown",
      },
    ],
  },
  {
    id: "update-2-01-00",
    publishedAt: "2026-09-04T04:20:00Z",
    patch: "2.01.00",
    kind: "update",
    title: "Camp, camera and quest changes follow",
    summary: "Version 2.01 adds a camp dispatch mission and camera tilt in photo mode, alongside listed fixes for quests, combat and graphics.",
    highlights: [
      "Silver donations grant ten times as many Camp Funds under the new rules.",
      "A Gold Bar Investment dispatch mission is added to camp activities.",
      "The notes address The Cursed Knight quest completion, underwater Body Slam freezes and rainy-weather visual noise.",
    ],
    source: {
      label: "Pearl Abyss · 2.01.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=128",
    },
  },
];

export const CATCH_UP_COVERAGE_START = CATCH_UP_MILESTONES[0].publishedAt;
