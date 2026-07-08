export const CURRENT_PATCH = "1.13.01";
export const PATCH_VERSIONS = ["1.13.01", "1.13.00", "1.12.00", "other"] as const;
export type PatchVersion = (typeof PATCH_VERSIONS)[number];

export const PLATFORMS = [
  "pc_steam",
  "ps5",
  "ps5_pro",
  "xbox_series_x",
  "xbox_series_s",
  "other",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  pc_steam: "PC (Steam)",
  ps5: "Base PS5",
  ps5_pro: "PS5 Pro",
  xbox_series_x: "Xbox Series X",
  xbox_series_s: "Xbox Series S",
  other: "Other",
};

export const CATEGORIES = [
  "performance",
  "crash_startup",
  "controls_gameplay",
  "graphics_visual",
  "audio",
  "quest_progression",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  performance: "Performance",
  crash_startup: "Crashes and startup",
  controls_gameplay: "Controls and gameplay",
  graphics_visual: "Graphics and visual",
  audio: "Audio",
  quest_progression: "Quests and progression",
  other: "Other",
};

export const SEVERITIES = ["low", "medium", "high", "blocking"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FREQUENCIES = ["once", "sometimes", "often", "always"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FIX_STATUSES = [
  "reported",
  "acknowledged",
  "fix_claimed",
  "verified_fixed",
  "persists",
] as const;
export type FixStatus = (typeof FIX_STATUSES)[number];
export const CONFIDENCES = ["seed_unverified", "low", "medium", "confirmed"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
