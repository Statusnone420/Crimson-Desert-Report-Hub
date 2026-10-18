import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/lib/automation/extract";
import { preScreenCandidate, shouldKeepExtractedSignal } from "@/lib/automation/relevance";

// Titles are verbatim from the live admin on 2026-10-18; snippets are short
// stand-ins, since the scanner keeps the real source text private.
const PATCH = { currentPatchVersion: "2.03.02", currentPatchPublishedAt: "2026-09-23T02:00:00.000Z" };
const THREAD = "https://steamcommunity.com/app/3321460/discussions/0/582809636676108588/";

function screen(title: string, snippet: string, dates: { publishedAt?: string; activeAt?: string } = {}) {
  return preScreenCandidate({
    title,
    snippet,
    url: THREAD,
    sourceDomain: "steamcommunity.com",
    sourcePublishedAt: dates.publishedAt ?? null,
    sourceActiveAt: dates.activeAt ?? null,
  }, PATCH);
}

function otherExtraction(text: string): ExtractionResult {
  return { category: "other", issueTitle: text, summary: text } as ExtractionResult;
}

describe("real reports the pre-filter used to drop before the AI saw them", () => {
  it.each([
    ["进去背包或者技能里面会出现闪退", "进去背包或者技能里面会出现闪退，每次都这样"],
    ["Tournament/Duel with Muskan is beyond broken", "The duel is beyond broken."],
    ["I cant craft the Pheonix pet", "It shows 0/1 despite having the feather."],
    ["I can’t craft the Pheonix pet", "Typed on a phone, with a curly apostrophe."],
    ["The 'Shadows Cast Over The River' quest is bugged", "The cutscene doesn't play."],
    ["PSA: The control mechanics in this game are EXTREMELY buggy", "Inputs get eaten."],
  ])("keeps %s", (title, snippet) => {
    expect(screen(title, snippet)).toEqual({ keep: true });
  });

  it.each([
    ["German", "Spiel stürzt beim Öffnen der Karte ab", "Seit gestern."],
    ["French", "Le jeu plante au chargement", "À chaque fois."],
    ["Spanish", "El juego se cierra al abrir el inventario", "Siempre."],
    ["Portuguese", "O jogo trava na cutscene do capítulo 5", "Sempre."],
    ["Russian", "Игра вылетает при открытии карты", "Каждый раз."],
    ["Japanese", "マップを開くと強制終了する", "毎回です。"],
    ["Korean", "인벤토리 열면 튕김", "매번 그래요."],
  ])("keeps a %s crash report", (_language, title, snippet) => {
    expect(screen(title, snippet)).toEqual({ keep: true });
  });
});

describe("everyday words in the new terms do not count as reports", () => {
  it.each([
    ["Всё зависит от билда", "Какое оружие лучше?"],
    ["Где найти лагерь бандитов?", "Подскажите."],
    ["Comment bloquer les attaques du boss ?", "Conseils."],
    ["崖から落ちるのが怖い", "高い所が苦手です。"],
    ["Can't wait for the DLC", "Hyped."],
    ["Can't stop playing this game", "Love it."],
    ["The duel is not broken anymore", "Works fine now."],
  ])("rejects %s", (title, snippet) => {
    expect(screen(title, snippet)).toMatchObject({ keep: false, reason: "source_not_issue_report" });
  });
});

describe("praise and roundups stay out", () => {
  it.each([
    ["Smooth 4K, no artifacts, great game.", "Runs great on my 4080."],
    ["Zero crashes in 40 hours", "Best open world this year."],
    ["Never crashed once", "Controls never clunky, runs great."],
  ])("rejects praise: %s", (title, snippet) => {
    expect(screen(title, snippet)).toMatchObject({ keep: false, reason: "source_not_issue_report" });
    expect(shouldKeepExtractedSignal(otherExtraction(title), `${title} ${snippet}`)).toEqual({ keep: false, reason: "category_other" });
  });

  it("still keeps praise that turns into a crash report", () => {
    expect(screen("No crashes until 2.03.02", "Now it crashes every hour.")).toEqual({ keep: true });
  });

  it("rejects a wiki roundup of other people's glitches", () => {
    expect(screen("Added: Glitches & Exploits – 2.03.02 Bugs", "Roundup of glitches and exploits.")).toMatchObject({
      keep: false,
      reason: "source_not_issue_report",
    });
  });
});

describe("rejects the owner confirmed as correct", () => {
  it.each([
    ["Save game Gelöscht", "Mein Spielstand wurde gelöscht, wie bekomme ich ihn zurück?"],
    ["Crimson Desert lost 65% of its player base", "Player count dropped since launch."],
    ["Will there be romance in the DLC?", "Asking about romance options."],
    ["Share Your Favorite Screenshot(s)", "Post your best shots."],
  ])("rejects %s", (title, snippet) => {
    expect(screen(title, snippet)).toMatchObject({ keep: false, reason: "source_not_issue_report" });
  });
});

describe("source dates on the same examples", () => {
  it("drops a thread when only an opening date before the patch is known", () => {
    // Opened 2026-03-20; its replies run to 2026-10-18 on the thread's last page,
    // which a search result never shows.
    expect(screen("Are the Graphics supposed to look this bad?", "The graphics look bad.", { publishedAt: "2026-03-20T01:23:00.000Z" }))
      .toEqual({ keep: false, reason: "stale_source" });
  });

  it("keeps the same graphics thread once a reply after the patch is known", () => {
    expect(screen("Are the Graphics supposed to look this bad?", "The graphics look bad.", {
      publishedAt: "2026-03-20T01:23:00.000Z",
      activeAt: "2026-10-18T06:57:00.000Z",
    })).toEqual({ keep: true });
  });

  it("drops an older thread when nothing shows a reply after the patch", () => {
    // Opened 2026-07-10; its last reply (2026-10-17) is visible only on the thread page.
    expect(screen("Time to count as holding button is extreme short", "The hold time is extremely short.", { publishedAt: "2026-07-10T22:19:00.000Z" }))
      .toEqual({ keep: false, reason: "stale_source" });
  });

  it("lets a reply after the patch past the date gate, where the text is judged on its own", () => {
    expect(screen("The 'Shadows Cast Over The River' quest is bugged", "The cutscene doesn't play.", {
      publishedAt: "2026-07-10T22:19:00.000Z",
      activeAt: "2026-10-17T15:21:00.000Z",
    })).toEqual({ keep: true });
    // A hold-time complaint names no fault, so it stays out even with a fresh reply.
    expect(screen("Time to count as holding button is extreme short", "The hold time is extremely short.", {
      publishedAt: "2026-07-10T22:19:00.000Z",
      activeAt: "2026-10-17T15:21:00.000Z",
    })).toEqual({ keep: false, reason: "source_not_issue_report" });
  });
});
