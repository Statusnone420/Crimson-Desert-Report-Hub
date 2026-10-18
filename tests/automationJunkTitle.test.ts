import { describe, expect, it } from "vitest";
import { isJunkClusterTitle } from "@/lib/automation/junkTitle";

describe("isJunkClusterTitle", () => {
  // Titles of the junk private clusters removed from production on 2026-10-04.
  it.each([
    "400 Bad Request",
    "400 Bad Request on Push Square page",
    "Crimson Desert",
    "Crimson Desert - Reddit",
    "Crimson Desert General Discussions",
    "Reddit - The heart of the internet",
    "The heart of the internet",
    "Post - X",
    "Steam Community :: Crimson Desert",
    "Steam Community :: Crimson Desert Enhanced",
    "r/CDguides - Reddit",
    "r/CrimsonDesert",
    "r/CrimsonDesert - Reddit",
    "r/CrimsonDesertLife",
    "No issue reported - positive feedback only",
    "No specific Crimson Desert issue identified",
    "No specific Crimson Desert issue reported in AMD driver discussion",
    "No specific gameplay issue reported",
    "Crimson Desert - PlayStation 5 (PS5) Forum - Page 3 (Page 3)",
    "Crimson Desert community signal",
    "404 Not Found",
    "  ",
    // Page and news titles that minted clusters before October 2026.
    "@PearlAbyss",
    "Crimson Desert, On Sale for 20% Off & Get the Free Enhanced Update :: Crimson Desert Enhanced",
    "Crimson Desert Enhanced Patch 2.01.00 Released & Detailed",
    "Crimson Desert received update 2.02.00 bringing Mac cross save ...",
    "Patch 2.01.00 broadly addresses system errors and stability",
    "Update 2.03.02 addresses quest issues and progression blockers",
    "\"Improved an issue where visual noise was particularly noticeable in ...",
    "Added: Glitches & Exploits – Version 2.03.02 Bugs",
    "Glitches & Exploits roundup for Version 2.03.02",
    "Version 2.02.00 bugs and known/reported issues roundup",
  ])("rejects %j", (title) => {
    expect(isJunkClusterTitle(title)).toBe(true);
  });

  // Real issue titles from production clusters, including ones that start
  // with a number, name a subreddit or mention "no".
  it.each([
    "Airborne maneuvers canceling mid-combat",
    "Annoying affects around screen : r/CrimsonDesert",
    "Crimson Desert LOD Issue : r/CrimsonDesert",
    "165 Hours in, game breaking bug. (Fixed) :: Crimson Desert General Discussions",
    "500 hours in and the game crashes on load",
    "r/CrimsonDesert - Screen cut off(ps5)",
    "Constant graphics glitches on Xbox since 1.14.00 patch",
    "Newly discovered object icons missing from the map",
    "No sound after the Praevus the Ancient boss fight",
    "Steam Community :: Guide :: How to Fps Drop / Game Stutter Exploit",
    "Crimson Desert Benchmarks & PC Performance Analysis",
    "Proton/Linux Broken :: Crimson Desert Discussões gerais",
    // Complaints that mention a patch, a fix line or glitches stay issues.
    "Update 2.03 brings back the stutter on PS5",
    "Patch 2.03.02 adds a crash when opening the map",
    "Patch 2.01.00 released and now the game will not launch",
    "Fixed an issue where... but the softlock is still there",
    "Graphical glitches and crashes since 2.03.02",
    "Known issue: inventory crash still happening",
  ])("keeps %j", (title) => {
    expect(isJunkClusterTitle(title)).toBe(false);
  });
});
