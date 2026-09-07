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

// Patch history begins at 1.13.00. Times are official notice publication times in UTC.
// Both August 28 hotfix notices display 00:00; their version order breaks that tie.
export const CATCH_UP_MILESTONES: readonly CatchUpMilestone[] = [
  {
    id: "update-1-13-00",
    publishedAt: "2026-07-03T03:00:00Z",
    patch: "1.13.00",
    kind: "update",
    title: "The Abyss opens to Oongka and Damiane",
    summary: "Version 1.13 expands character access, equipment and dye options.",
    highlights: [
      "Most weapons and some disguise outfits become dyeable.",
      "Hunter’s Sigil lets bird pets retrieve suitable prey and gatherables when equipped.",
    ],
    source: {
      label: "Pearl Abyss · 1.13.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
    },
  },
  {
    id: "hotfix-1-13-01",
    publishedAt: "2026-07-08T05:51:00Z",
    patch: "1.13.01",
    kind: "hotfix",
    title: "A hotfix targets crashes and progression",
    summary: "Pearl Abyss lists fixes for bear-riding crashes, missing challenge rewards and Hoenmark Ruins liberation.",
    highlights: [
      "Character-rendering corrections cover consoles and AMD-based systems.",
      "The notes also report frame-rate improvements in certain environments.",
    ],
    source: {
      label: "Pearl Abyss · 1.13.01 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=106",
    },
  },
  {
    id: "update-1-14-00",
    publishedAt: "2026-07-16T09:00:00Z",
    patch: "1.14.00",
    kind: "update",
    title: "Cross-save arrives",
    summary: "Version 1.14 introduces cross-save between PlayStation, Xbox, Steam and Epic Games Store.",
    highlights: [
      "Link platform accounts through Cross-Save Settings, then upload to the dedicated save slot.",
      "Damiane’s Skystep adopts the same input as Oongka’s Vertical Flight.",
    ],
    source: {
      label: "Pearl Abyss · 1.14.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=108",
    },
    related: [
      {
        label: "Cross-save setup guide",
        url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=107",
      },
    ],
  },
  {
    id: "update-1-15-00",
    publishedAt: "2026-07-24T02:40:00Z",
    patch: "1.15.00",
    kind: "update",
    title: "Cross-save loading and crop fixes",
    summary: "The notes target crashes when loading cross-save data and crops that would stop growing or could not be harvested.",
    highlights: [
      "HDR interface colors and transparency are also addressed.",
    ],
    source: {
      label: "Pearl Abyss · 1.15.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=109",
    },
  },
  {
    id: "update-1-16-00",
    publishedAt: "2026-08-01T03:30:00Z",
    patch: "1.16.00",
    kind: "update",
    title: "Trading expands across Pywel",
    summary: "The trading update adds 133 posts, seven wagon workshops and a Trade map tab. Some posts require quest progress.",
    highlights: [
      "Prices respond to repeated sales at one post; cargo can move between horses and wagons.",
      "Retrieving a horse or wagon, or destroying a wagon, can lose more trade goods.",
      "PC gains FSR Upscaling 4.1 support for Radeon RX 7000 GPUs.",
    ],
    source: {
      label: "Pearl Abyss · 1.16.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=110",
    },
  },
  {
    id: "hotfix-1-16-01",
    publishedAt: "2026-08-02T01:00:00Z",
    patch: "1.16.01",
    kind: "hotfix",
    title: "Camp storage gets a targeted hotfix",
    summary: "The notes address camp storage opening as wagon cargo after loading trade goods at a regional workshop.",
    highlights: [],
    source: {
      label: "Pearl Abyss · 1.16.01 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=111",
    },
  },
  {
    id: "hotfix-1-16-02",
    publishedAt: "2026-08-03T14:40:00Z",
    patch: "1.16.02",
    kind: "hotfix",
    title: "Save-loading and graphics fixes",
    summary: "The notes target stalled save loads, black screens and unavailable indoor housing features.",
    highlights: [
      "AMD graphics fixes concern Ray Regeneration on Radeon RX 9070 XT or higher cards.",
      "A Mac crash fix concerns the MetalFX Denoising Upscaler setting.",
    ],
    source: {
      label: "Pearl Abyss · 1.16.02 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=112",
    },
  },
  {
    id: "hotfix-1-16-03",
    publishedAt: "2026-08-04T04:50:00Z",
    patch: "1.16.03",
    kind: "hotfix",
    title: "A disappearing-shield hotfix",
    summary: "The notes target certain shields disappearing after switching to dual-wielded weapons, saving and reloading.",
    highlights: [],
    source: {
      label: "Pearl Abyss · 1.16.03 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=114",
    },
  },
  {
    id: "hotfix-1-16-04",
    publishedAt: "2026-08-05T09:00:00Z",
    patch: "1.16.04",
    kind: "hotfix",
    title: "Equipment counts after reloading",
    summary: "The notes target incorrect equipment quantities after receiving certain gear, saving and reloading.",
    highlights: [],
    source: {
      label: "Pearl Abyss · 1.16.04 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=115",
    },
  },
  {
    id: "update-1-17-00",
    publishedAt: "2026-08-07T12:30:00Z",
    patch: "1.17.00",
    kind: "update",
    title: "Map markers and movement fixes",
    summary: "The notes address map icons for unobtainable treasure, trade-route display and movement stutter.",
    highlights: [
      "Food quickslots selecting an unintended item after food runs out are also addressed.",
      "The notes include a correction to Desperate Rescue challenge progress.",
    ],
    source: {
      label: "Pearl Abyss · 1.17.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=116",
    },
  },
  {
    id: "update-1-18-00",
    publishedAt: "2026-08-15T03:43:00Z",
    patch: "1.18.00",
    kind: "update",
    title: "Quest knowledge and camera choices",
    summary: "Research switches from Silver to Camp Funds, and a new quest knowledge category records progress.",
    highlights: [
      "Some completed quests grant their knowledge entries retroactively.",
      "Lock-on camera rotation offers manual, semi-auto and auto modes.",
    ],
    source: {
      label: "Pearl Abyss · 1.18.00 patch notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=117",
    },
  },
  {
    id: "hotfix-1-18-01",
    publishedAt: "2026-08-16T04:00:00Z",
    patch: "1.18.01",
    kind: "hotfix",
    title: "Older housing items and startup crashes",
    summary: "The notes address missing housing items placed in version 1.12.00 or earlier, plus crashes after launch.",
    highlights: [
      "Delayed NPC interactions with the lantern lit and incorrect map areas are also listed.",
    ],
    source: {
      label: "Pearl Abyss · 1.18.01 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=119",
    },
  },
  {
    id: "hotfix-1-18-02",
    publishedAt: "2026-08-16T10:00:00Z",
    patch: "1.18.02",
    kind: "hotfix",
    title: "Silver balances and shop controls",
    summary: "The notes target Silver resetting after A Secret Deal in certain saves and controls freezing after shopping.",
    highlights: [
      "Comrade counts incorrectly showing zero and stuttering movement are also covered.",
    ],
    source: {
      label: "Pearl Abyss · 1.18.02 hotfix notes",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=120",
    },
  },
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
export const CATCH_UP_HIGHLIGHTS_START = CATCH_UP_MILESTONES.find(({ patch }) => patch === "2.00.00")!.publishedAt;
