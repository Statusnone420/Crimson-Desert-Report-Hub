import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClaimedFixes, parseOfficialPatchDetail } from "@/lib/officialPatch";

/**
 * Section capture is an annotation on top of the existing claim extraction:
 * which lines are kept, their text, their order, the dedupe, and the first-30
 * cap must stay byte-identical to the pre-section parser. Both fixtures are
 * trimmed verbatim from live Pearl Abyss notice pages (captured 2026-07-25);
 * the full raw captures stay untracked under output/.
 */
const board109 = readFileSync(new URL("./fixtures/official-patch-1.15.00.html", import.meta.url), "utf8");
const board105 = readFileSync(new URL("./fixtures/official-patch-1.13.00.html", import.meta.url), "utf8");

describe("section capture on the real 1.15.00 page (board 109)", () => {
  it("maps all 16 claims to the source's own section headings", () => {
    const { fixes, totalFixLines } = parseClaimedFixes(board109);

    expect(fixes).toHaveLength(16);
    expect(totalFixLines).toBe(16);
    expect(fixes.map((fix) => fix.section)).toEqual([
      "Content",
      "Content",
      "Content",
      "Content",
      "Content",
      "Content",
      "Controls",
      "Controls",
      "Combat / Action",
      "Combat / Action",
      "Graphics / Settings",
      "Localization",
      "Others",
      "Others",
      "Others",
      "Others",
    ]);
    expect(fixes[0].text).toBe("Fixed an issue where certain bosses would appear transparent during battle.");
    expect(fixes[3].text).toBe(
      "[Oongka/Damiane] Fixed an issue where the lock status of equipped gear would not be saved.",
    );
    expect(fixes[15].text).toBe(
      'Fixed an issue where Kliff would partially sink into the ground when using "Blinding Flash Finisher" on a slope.',
    );
  });

  it("threads section data and the total through parseOfficialPatchDetail", () => {
    const detail = parseOfficialPatchDetail(board109, {
      boardNo: "109",
      title: "Patch Notes Version 1.15.00",
      patchVersion: "1.15.00",
      officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=109",
    });

    expect(detail.claimedFixes).toHaveLength(16);
    expect(detail.claimedFixTotal).toBe(16);
    expect(detail.claimedFixes[0].section).toBe("Content");
  });
});

describe("truncation honesty on the real 1.13.00 page (board 105)", () => {
  it("keeps the first 30 exactly as before while counting all 72 qualifying unique lines", () => {
    const { fixes, totalFixLines } = parseClaimedFixes(board105);

    expect(fixes).toHaveLength(30);
    expect(totalFixLines).toBe(72);
    // The kept set is the pre-section parser's first 30, byte-identical.
    expect(fixes[0].text).toBe(
      "Fixed an issue where the auto-tracked target would switch to another quest in certain situations.",
    );
    expect(fixes[29].text).toBe(
      "Fixed an issue where Trust notifications were not displayed properly in the notification history.",
    );
    // The 31st qualifying line is counted but never stored.
    expect(fixes.some((fix) => fix.text.startsWith("[Mouse/Keyboard]"))).toBe(false);
  });

  it("labels the truncated run with the sections the kept claims sit under", () => {
    const { fixes } = parseClaimedFixes(board105);

    const bySection = new Map<string | null, number>();
    for (const fix of fixes) bySection.set(fix.section, (bySection.get(fix.section) ?? 0) + 1);
    expect(Object.fromEntries(bySection)).toEqual({
      Content: 10,
      Controls: 4,
      "Combat / Action": 13,
      UI: 3,
    });
  });
});

describe("section candidate boundaries", () => {
  const container = '<div class="board_content">';

  it("captures no sections at all when the board_content container is absent", () => {
    const html = `
      <span style="font-size: 20px;">Content</span>
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes).toEqual([{ text: "Fixed an issue where the map crashed the game.", section: null }]);
  });

  it("never treats bold text as a heading — only 20px-styled spans", () => {
    const html = `${container}
      <strong>Content</strong>
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes[0].section).toBeNull();
  });

  it("tolerates other style properties and attribute ordering on the heading span", () => {
    const html = `${container}
      <div><span class="lead" style="color: #eed39e; font-size: 20px; line-height: 1.2;">Combat / Action</span></div>
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes[0].section).toBe("Combat / Action");
  });

  it("ignores headings that sit before the board_content container", () => {
    const html = `
      <span style="font-size: 20px;">Site Navigation</span>
      ${container}
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes[0].section).toBeNull();
  });

  it("ignores a 20px span inside a bullet — emphasis is not a heading", () => {
    const html = `${container}
      <span style="font-size: 20px;">Content</span>
      <ul>
        <li>Fixed an issue where <span style="font-size: 20px;">the map</span> crashed the game.</li>
        <li>Fixed an issue where crops would stop growing.</li>
      </ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes.map((fix) => fix.section)).toEqual(["Content", "Content"]);
  });

  it("never labels a group with the post title or an over-long heading", () => {
    const html = `${container}
      <span style="font-size: 20px;">Patch Notes Version 1.15.00</span>
      <span style="font-size: 20px;">This heading is far too long to be a real section label on the board</span>
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes[0].section).toBeNull();
  });

  it("resets to unlabeled at a length-rejected heading instead of inheriting the previous group", () => {
    const html = `${container}
      <span style="font-size: 20px;">Content</span>
      <ul><li>Fixed an issue where crops stopped growing.</li></ul>
      <span style="font-size: 20px;">This heading is far too long to be a real section label on the board</span>
      <ul><li>Fixed an issue where the quest tracker froze mid-cutscene.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    // The second claim sits under a heading the parser cannot use as a label;
    // it must render unlabeled, never inside a group the source never drew.
    expect(fixes.map((fix) => fix.section)).toEqual(["Content", null]);
  });

  it("rejects style-token lookalikes that are not the official 20px heading", () => {
    const html = `${container}
      <span style="font-size: 20pxx">Fake one</span>
      <span style="--font-size: 20px">Fake two</span>
      <span style="x-font-size: 20px">Fake three</span>
      <span data-style="font-size: 20px">Fake four</span>
      <span style="font-size: 120px">Fake five</span>
      <ul><li>Fixed an issue where the map crashed the game.</li></ul>
    `;

    const { fixes } = parseClaimedFixes(html);
    expect(fixes[0].section).toBeNull();
  });

  it("counts qualifying lines past the cap without changing the kept set", () => {
    const lines = Array.from({ length: 35 }, (_, index) => `<li>Fixed issue number ${index}.</li>`).join("\n");
    const { fixes, totalFixLines } = parseClaimedFixes(`${container}<ul>${lines}</ul>`);

    expect(fixes).toHaveLength(30);
    expect(totalFixLines).toBe(35);
    expect(fixes[29].text).toBe("Fixed issue number 29.");
  });
});
