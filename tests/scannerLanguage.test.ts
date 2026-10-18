import { describe, expect, it } from "vitest";
import { englishOnly, isMostlyNonEnglish, NOT_IN_ENGLISH } from "@/lib/language";
import { preScreenCandidate } from "@/lib/automation/relevance";
import { admitsLanguageReview, englishStorage, paidAiEnabled } from "@/lib/automation/run";

describe("telling English from the game's other big review languages", () => {
  it.each([
    ["Simplified Chinese", "进去背包或者技能里面会出现闪退"],
    ["Korean", "인벤토리 열면 튕김"],
    ["Russian", "Игра вылетает при открытии карты"],
    ["Brazilian Portuguese", "O jogo não abre depois da atualização"],
    ["French", "Le jeu est très beau mais la quête ne se termine pas"],
    ["Spanish", "El juego se cierra cuando abro el mapa"],
    ["German", "Die Quest lässt sich nicht abschließen und das Spiel ist kaputt"],
    ["Turkish", "Bu oyun çok güzel ama görev bitmiyor"],
    ["Polish", "Gra jest bardzo ładna ale nie mogę skończyć zadania"],
    ["Italian", "Il gioco è molto bello ma non riesco a finire la missione"],
    ["Japanese", "マップを開くと強制終了する"],
    ["German, short", "Spiel stürzt ab"],
    ["Polish, short", "Gra wywala"],
    ["Turkish, short", "Oyun çöküyor"],
    ["Spanish, short", "El mapa no carga"],
    ["French, in capitals", "LE JEU PLANTE"],
    // Only a problem word marks these: no function word, no accent.
    ["Spanish, problem words only", "Pantalla negra"],
    ["Portuguese, problem words only", "Tela preta"],
    ["French, problem words only", "Plantage constant"],
    ["Polish, problem words only", "Czarny ekran"],
    ["Italian, problem words only", "Errore"],
  ])("%s is not English", (_language, text) => {
    expect(isMostlyNonEnglish(text)).toBe(true);
  });

  it.each([
    "The game crashes when I open the map",
    "Crimson Desert patch 2.03.02 stutter in Pywel",
    "Tournament/Duel with Muskan is beyond broken",
    "Crimson Desert player issue on Steam",
    "Crash when opening map",
    "Kliff stuck in a wall after the update",
    // Keys, codes and abbreviations that look like another language's words.
    "Error E100 crash",
    "Can't press E",
    "Y button broken",
    "EU servers down",
    "Lag on EU servers since the ET maintenance",
    "Windows OS crash",
    "",
  ])("%j is English", (text) => {
    expect(isMostlyNonEnglish(text)).toBe(false);
  });

  it("hides text in another language behind an English placeholder", () => {
    expect(englishOnly("背包里的物品消失了")).toBe(NOT_IN_ENGLISH);
    expect(englishOnly("Items vanish from the backpack")).toBe("Items vanish from the backpack");
  });
});

const PATCH = { currentPatchVersion: "2.03.02", currentPatchPublishedAt: "2026-09-23T02:00:00.000Z" };
const THREAD = "https://steamcommunity.com/app/3321460/discussions/0/582809636676108588/";
const screen = (title: string, snippet: string, sourceDomain = "steamcommunity.com") =>
  preScreenCandidate({ title, snippet, url: THREAD, sourceDomain }, PATCH);

describe("posts the word lists cannot read", () => {
  it("marks a non-English post with no known symptom word for an AI language review", () => {
    expect(screen("背包里的物品消失了", "背包里的物品消失了，找不回来")).toEqual({
      keep: false, reason: "source_not_issue_report", languageReview: true,
    });
    expect(screen("Die Quest lässt sich nicht abschließen", "Das Spiel ist nicht fertig.")).toMatchObject({ languageReview: true });
  });

  it("judges the title and the snippet apart", () => {
    expect(screen("背包里的物品消失了", "Crimson Desert discussion")).toMatchObject({ languageReview: true });
  });

  it("does not mark English posts, recognized praise, or the publisher's own pages", () => {
    expect(screen("Great game, highly recommended", "Loved every hour.")).not.toHaveProperty("languageReview");
    expect(screen("没有闪退，很流畅", "")).not.toHaveProperty("languageReview");
    expect(preScreenCandidate({
      title: "붉은사막 업데이트 안내", snippet: "업데이트 내용을 안내합니다.", url: "https://www.pearlabyss.com/ko-KR/news", sourceDomain: "pearlabyss.com",
    }, PATCH)).not.toHaveProperty("languageReview");
  });

  it.each([
    ["Turkish", "Oyun haritayı açınca çöküyor"],
    ["Polish", "Gra wywala do pulpitu przy otwieraniu mapy"],
    ["Italian", "Il gioco crasha quando apro la mappa"],
  ])("keeps a %s crash report on its words alone", (_language, title) => {
    expect(screen(title, "")).toEqual({ keep: true });
  });

  it.each([
    "Keine Abstürze bis zum Patch",
    "Aucun plantage avant cette mise à jour",
    "更新之前没有闪退",
  ])("keeps %s: it says the problem started afterward", (title) => {
    expect(screen(title, "")).toEqual({ keep: true });
  });

  it.each([
    ["Turkish", "Hiç çökme yok, harika oyun"],
    ["Polish", "Zero błędów, świetna gra"],
    ["Italian", "Nessun crash, gioco fantastico"],
  ])("rejects %s praise", (_language, title) => {
    expect(screen(title, "")).toMatchObject({ keep: false, reason: "source_not_issue_report" });
  });
});

describe("which rejections may become a language review", () => {
  const flagged = { keep: false as const, reason: "source_not_issue_report" as const, languageReview: true as const };

  it("spends the scarce calls on thumbs-down reviews and forum, Reddit or web posts", () => {
    expect(admitsLanguageReview({ source: "web_search", steam: undefined }, flagged)).toBe(true);
    expect(admitsLanguageReview({ source: "steam_review", steam: { votedUp: false } as never }, flagged)).toBe(true);
    expect(admitsLanguageReview({ source: "steam_review", steam: { votedUp: true } as never }, flagged)).toBe(false);
    expect(admitsLanguageReview({ source: "web_search", steam: undefined }, { keep: false, reason: "source_not_issue_report" })).toBe(false);
  });
});

describe("the extra non-English calls", () => {
  const clean = { skips: [], llmCostUsd: 0 };
  it("are never granted while the paid AI lane is switched off", () => {
    expect(paidAiEnabled(clean, { maxLlmCalls: 0, remainingLlmUsd: 0.5 } as never)).toBe(false);
    expect(paidAiEnabled({ skips: ["openrouter_budget_exceeded"], llmCostUsd: 0 }, { maxLlmCalls: 4, remainingLlmUsd: 0.5 } as never)).toBe(false);
    expect(paidAiEnabled({ skips: [], llmCostUsd: 0.5 }, { maxLlmCalls: 4, remainingLlmUsd: 0.5 } as never)).toBe(false);
    expect(paidAiEnabled(clean, { maxLlmCalls: 4, remainingLlmUsd: 0.5 } as never)).toBe(true);
  });
});

describe("storing only English", () => {
  const ai = { extractionProvider: "openrouter" as const, issueTitle: "Crash after patch 2.03.02 when opening the map", summary: "The game crashes when opening the map." };

  it("stores an English post as it is", () => {
    expect(englishStorage({ title: "Game crashes on the map" }, "Every time.", { ...ai, extractionProvider: "deterministic" })).toEqual({ nonEnglish: false, store: true });
  });

  it("stores a post in another language only under the AI's English title, without version numbers", () => {
    expect(englishStorage({ title: "打开地图就闪退" }, "打开地图就闪退", ai)).toEqual({
      nonEnglish: true, store: true, storedTitle: "Crash after patch when opening the map",
    });
    // A Steam review keeps its English placeholder title; its body decides.
    expect(englishStorage({ title: "Crimson Desert player issue on Steam" }, "打开地图就闪退", ai)).toMatchObject({ nonEnglish: true, store: true });
    // The AI keeps an error code as it is, and the title is still English.
    expect(englishStorage({ title: "Erro E100 ao abrir o jogo" }, "", {
      ...ai, issueTitle: "Error E100 crash", summary: "The game shows error E100 and closes.",
    })).toEqual({ nonEnglish: true, store: true, storedTitle: "Error E100 crash" });
  });

  it("stores nothing when the AI did not read it or answered in another language", () => {
    expect(englishStorage({ title: "Spiel stürzt ab" }, "", { ...ai, extractionProvider: "deterministic" })).toEqual({ nonEnglish: true, store: false });
    expect(englishStorage({ title: "打开地图就闪退" }, "", { ...ai, extractionProvider: "deterministic" })).toEqual({ nonEnglish: true, store: false });
    expect(englishStorage({ title: "打开地图就闪退" }, "", { ...ai, summary: "打开地图就闪退" })).toEqual({ nonEnglish: true, store: false });
    expect(englishStorage({ title: "Pantalla negra" }, "", { ...ai, extractionProvider: "deterministic" })).toEqual({ nonEnglish: true, store: false });
  });
});
