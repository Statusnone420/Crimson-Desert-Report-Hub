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
  ])("keeps %j", (title) => {
    expect(isJunkClusterTitle(title)).toBe(false);
  });
});
