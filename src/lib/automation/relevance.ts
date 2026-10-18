import type { ExtractionResult } from "@/lib/automation/extract";
import { domainTier, isOfficialDomain } from "@/lib/automation/domains";
import { evaluateCurrentPatchEligibility, mentionsOnlyOtherPatch } from "@/lib/automation/eligibility";
import { isMostlyNonEnglish } from "@/lib/language";

export type RelevanceSkipReason =
  | "category_other"
  | "source_not_issue_report"
  | "wrong_patch"
  | "stale_source"
  | "off_topic";

/**
 * Observation genres: named non-complaint genres the pre-screen already
 * recognizes. A genre on a rejection changes the candidate's DESTINATION
 * (observation lane instead of the trash), never the rejection itself — the
 * evidence funnel's keep/reject behavior is byte-for-byte unchanged.
 */
export type ObservationKind = "patch_release" | "press_reception" | "fix_announcement" | "community_ask";

export type SignalRelevanceDecision =
  | { keep: true }
  | {
      keep: false;
      reason: RelevanceSkipReason;
      observationKind?: ObservationKind;
      /**
       * A post in another language that names no symptom the word lists know.
       * The scan may hand a few of these to the AI instead of dropping them;
       * every other caller treats the decision as the rejection it is.
       */
      languageReview?: true;
    };

export type CandidatePreScreenInput = {
  title: string;
  snippet: string;
  url?: string | null;
  sourceDomain: string | null;
  sourcePublishedAt?: string | null;
  /** Latest activity the source shows; see `SourceFreshnessInput.sourceActiveAt`. */
  sourceActiveAt?: string | null;
};

const SYMPTOM_PATTERNS = [
  /\b(?:fps|frame ?rate|framerate|performance mode)\b.{0,60}\b(?:drop|drops|dropped|low|lower|lowered|lowers|reduced|reduces|reducing|tanked|tanks|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:drop|drops|dropped|low|lower|lowered|lowers|reduced|reduces|reducing|tanked|tanks|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b.{0,60}\b(?:fps|frame ?rate|framerate)\b/i,
  /\b(?:fps|frame ?rate|framerate)\b.{0,60}\b(?:after|since|caused by|from)\b.{0,40}\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made)\b.{0,40}\b(?:fps|frame ?rate|framerate|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:stutters|stuttering|hitches|hitching)\b(?!\s+(?:is|was|got|gets|reduced|fixed|gone|improved|better|less))\b/i,
  /\bloading times?\b.{0,50}\b(?:slow|slower|long|longer|worse|awful|bad|broken|regress|regression|increased|doubl(?:e[sd]?|ing))\b/i,
  /\b(?:slow|slower|long|longer|worse|awful|bad|broken|increased|doubl(?:e[sd]?|ing))\b.{0,50}\bloading times?\b/i,
  /\bframe ?time\b.{0,50}\b(?:spike|spikes|spiking|stutter|stutters|stuttering|bad|worse|regress|regression)\b/i,
  /\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b.{0,50}\bperformance\b/i,
  /\bperformance\b.{0,50}\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b/i,
  // Bare stutter/hitch/lag — the most common performance complaints, carrying no fps/frame
  // qualifier ("the game stutters in towns", "constant hitching", "lags horribly"). Mirrors
  // classifySignal's /stutter/ and /lag/ rules so the pre-screen never drops what the
  // classifier would keep. The stutter lookahead skips "stutter is gone/reduced/fixed" (a
  // fixed-symptom claim); marketing "fixes lag" / "reduces stutters" is removed by
  // FIX_CLAIM_SYMPTOM before this pattern is consulted.
  /\b(?:stutters|stuttering|hitches|hitching|micro-?stutters?|micro-?stuttering)\b(?!\s+(?:is|was|got|gets|reduced|fixed|gone|improved|better|less))/i,
  /\blag(?:s|gy|ging)?\b/i,
  /\b(?:crash|crashes|crashed|crashing|crash-to-desktop|ctd|freeze|freezes|freezing|hang|hangs|hanging)\b/i,
  /\b(?:black ?screen|infinite (?:load|loading)|stuck (?:on|at) (?:load|loading|boot))\b/i,
  /\b(?:lockup|lockups|locks up|input lock|input locks|unresponsive|controls? (?:stop|stops|stopped|lock|locks|locked|freeze|freezes))\b/i,
  /\b(?:artifact|artifacts|ghosting|flicker|flickering|texture shimmer|screen tearing)\b/i,
  // "graphics" is how players say it: "Are the Graphics supposed to look this bad?"
  /\b(?:graphics|graphical|rendering|lighting|shadows?|visuals?|pop.?in)\b.{0,60}\b(?:broken|bugged|glitch(?:y|es|ing)?|missing|flicker|flickering|wrong|bad|worse|washed out)\b/i,
  /\b(?:broken|bugged|glitch(?:y|es|ing)?|missing|flicker|flickering|wrong|bad|worse|washed out)\b.{0,60}\b(?:graphics|graphical|rendering|lighting|shadows?|visuals?|pop.?in)\b/i,
  /\b(?:won'?t|will not|doesn'?t|does not|can'?t|cannot|not)\s+(?:launch|start|load|progress|complete)\b/i,
  // Blocked actions players report in their own words ("I cant craft the pet",
  // "can't equip the new sword"). The verb list is closed on purpose: "can't
  // wait" and "can't stop playing" are praise, not reports, and so are "can't
  // play (it) enough" and "can't play anything else".
  /\b(?:can'?t|cannot|can not|unable to|won'?t let (?:me|you|us))\s+(?:even\s+|still\s+)?(?:craft|use|equip|unequip|open|interact|claim|unlock|buy|purchase|sell|accept|talk|enter|access|select|summon|mount|ride|loot|pick up|fast travel|travel|save|continue|finish|play(?!(?:\s+(?:it|this(?:\s+(?:game|one))?|the\s+game))?\s+enough\b|\s+any(?:thing)?\s+(?:else|other)\b)|join|skip|move|aim|dodge|parry|hold|press|redeem|upgrade|repair|cook|tame|teleport|respawn)\b/i,
  // A bare "is (beyond|completely) broken/bugged" with no symptom noun — "The duel
  // with Muskan is beyond broken". Negated forms ("is not broken", "is no longer
  // bugged") are not complaints.
  /\b(?:is|are|was|were|seems?|feels?|looks?|gets?|got)\s+(?!(?:not|no\s+longer|never)\b)(?:\w+\s+){0,2}?(?:broken|bugged|glitched|busted)\b/i,
  // A negation up to two words back ("is no longer bugged", "not very buggy")
  // makes it a fixed or praised state, not a report.
  /(?<!\b(?:not|never|no\s+longer|isn'?t|aren'?t|wasn'?t|weren'?t|hardly|barely)\s+(?:\w+\s+){0,2})\bbugg(?:ed|y)\b/i,
  /\b(?:no|missing|lost|muted|silent|broken)\s+(?:audio|sound|music|voice(?:s| lines?)?|sfx)\b/i,
  /\b(?:audio|sound|music|voice(?:s| lines?)?|sfx)\b.{0,50}\b(?:missing|gone|muted|silent|broken|cut(?:s|ting)? out|doesn'?t play|not playing|desync(?:ed)?|out of sync)\b/i,
  /\b(?:quests?|missions?|objectives?|npcs?|cutscenes?|dialogue)\b.{0,60}\b(?:stuck|blocked|frozen|missing|broken|bugged|softlock(?:ed)?|cannot progress|can'?t progress|won't complete|will not complete|not progressing|not spawning)\b/i,
  /\b(?:softlock(?:ed)?|cannot progress|can'?t progress|won't complete|will not complete)\b/i,
  // Cross-save / save-data failures — the launch feature of 1.14.00. These carry no
  // legacy symptom noun ("Cross-save not working?", "Cross Save error PS5 Pro"), which
  // is exactly how real complaints were falling out as "not an issue report".
  /\bcross[- ]?save\b.{0,60}\b(?:errors?|fail(?:s|ed|ing)?|broken|not working|won'?t work|can'?t|cannot|crash(?:es|ed|ing)?|missing|lost|stuck)\b/i,
  /\b(?:errors?|fail(?:s|ed|ing)?|broken|crash(?:es|ed|ing)?|missing|lost)\b.{0,60}\bcross[- ]?save\b/i,
  /\b(?:save|saves|save (?:file|data|slot)|progress)\b.{0,50}\b(?:lost|missing|corrupt(?:ed)?|gone|wiped|deleted|won'?t (?:load|sync)|not (?:loading|syncing))\b/i,
  // Generic complaint shapes with no symptom noun at all: "not working", bare
  // "error(s)", bare "glitch(es)", "still broken/angry/unplayable", and the
  // question-form openers players actually use. Recall-biased on purpose — the
  // promotion guard, not this list, is the precision boundary.
  /\b(?:won'?t|will not|doesn'?t|does not|can'?t|cannot|not|stopped)\s+work(?:ing)?\b/i,
  /\berrors?\b/i,
  /\bglitch(?:es|ed|y|ing)?\b/i,
  /\bstill\s+(?:broken|bugged|glitched|angry|happening|unplayable|not (?:working|fixed))\b/i,
  /\bunplayable\b/i,
  /\b(?:am i the only one|is it just me|anyone else)\b.{0,80}\b(?:problems?|issues?|bugs?|glitch(?:es)?|broken|crash(?:es|ing)?|errors?|not working)\b/i,
  /\b(?:graphical|graphics|visual|texture)\s+(?:problems?|issues?|bugs?)\b/i,
  ...multilingualSymptomPatterns(),
] as const;

/**
 * Players report in their own language, and none of the English patterns above
 * can see "进去背包会出现闪退" (it crashes opening the backpack). These are the
 * common crash, freeze, stutter, bug, error and won't-start words in Chinese,
 * Japanese, Korean, German, French, Spanish, Portuguese and Russian. CJK has no
 * word spacing, so those terms match as substrings; the rest need letter
 * boundaries, and `\p{L}*` marks a stem that takes any ending. Save-loss words
 * stay out: "Save game Gelöscht" is usually a support question, not a bug.
 */
function multilingualSymptomPatterns(): RegExp[] {
  const cjk = [
    // Chinese, simplified and traditional
    "闪退", "閃退", "崩溃", "崩潰", "卡死", "卡顿", "卡頓", "掉帧", "掉幀", "黑屏", "花屏", "闪屏", "閃屏", "报错", "報錯",
    "无法启动", "無法啟動", "进不去", "進不去", "打不开", "打不開", "任务卡住", "任務卡住", "没有声音", "沒有聲音",
    // Japanese
    "クラッシュ", "フリーズ", "強制終了", "ゲームが落ち", "進行不能", "起動しない", "起動できない", "カクつ", "カクカク", "ブラックスクリーン", "バグ", "エラー",
    // Korean
    "튕김", "튕겨", "튕기", "크래시", "버그", "멈춤", "멈춰", "프리징", "끊김", "진행 불가", "진행불가", "오류", "에러", "실행이 안", "검은 화면",
  ];
  const lettered = [
    // German
    // Separable verbs split around other words: "Das Spiel stürzt ständig ab".
    "absturz\\p{L}*", "abstürz\\p{L}*", "st(?:ü|ue)rzt(?:\\s+\\p{L}+){0,4}\\s+ab", "friert(?:\\s+\\p{L}+){0,4}\\s+ein", "eingefroren",
    "ruckel\\p{L}*", "ruckler", "startet nicht", "funktioniert nicht", "schwarzer bildschirm", "verbuggt", "kaputt",
    "h(?:ä|ae)ngt sich(?:\\s+\\p{L}+){0,3}\\s+auf",
    // French
    "plantage\\p{L}*", "(?:jeu|il|ça|ca)\\s+plante", "écran noir", "ecran noir", "ne se lance pas", "ne démarre pas", "ne fonctionne pas",
    // Past participles only: "bloquer" is the combat verb "to block".
    "bugu[ée]\\p{L}*", "saccade\\p{L}*", "bloqu(?:é|ée|és|ées)",
    // Spanish
    "se cierra", "crashea\\p{L}*", "se congela\\p{L}*", "pantalla negra", "no funciona", "no inicia", "no arranca", "tirones",
    "buguead\\p{L}*", "bugead\\p{L}*", "se traba\\p{L}*",
    // Portuguese
    "(?:jogo|game)\\s+trava\\p{L}*", "travamento\\p{L}*", "crashand\\p{L}*", "fecha sozinho", "tela preta", "não funciona", "nao funciona",
    "não abre", "nao abre", "bugad\\p{L}*", "bugou",
    // Russian. Closed endings where a bare stem is an everyday word: "зависит"
    // means "depends", "лагерь" is a camp, "багаж" is luggage.
    "вылет\\p{L}*", "краш\\p{L}*", "завис(?:ла|ло|ли|ает|ают|ание|ания)?", "фриз\\p{L}*", "лаг(?:и|ов|ает|ают|ал|ала|ало|ует|ать)?",
    "баг(?:и|ов|а|ом|ами|нут\\p{L}*|ован\\p{L}*)?", "не запускается", "ч[её]рный экран", "ошибк\\p{L}*", "не работает",
    // Turkish
    "çök(?:üyor|tü|me|üyo)\\p{L}*", "donuyor", "dondu", "takılıyor", "kasıyor", "kasma\\p{L}*", "açılmıyor", "çalışmıyor",
    "siyah ekran", "masaüstüne atıyor",
    // Polish
    "crashuje", "wywala\\p{L}*", "zawiesza się", "zacina się", "przycina", "błąd", "błędy", "błędów", "nie działa",
    "nie uruchamia się", "czarny ekran", "zbugowan\\p{L}*",
    // Italian
    "crasha\\p{L}*", "si blocca", "si chiude", "scatti", "errore", "buggat\\p{L}*", "non funziona", "non si avvia", "schermo nero",
  ];
  return [
    new RegExp(cjk.join("|"), "u"),
    new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${lettered.join("|")})(?![\p{L}\p{N}])`, "iu"),
  ];
}

// The press subset of BROAD_CONTENT_PATTERNS: coverage worth keeping as an
// observation. Guides/trailers/walkthroughs stay plain rejects — they are
// content ABOUT the game, not reception OF the patch.
const PRESS_RECEPTION_PATTERNS = [
  /\breview\b/i,
  /\bbenchmark\b/i,
  /\bperformance test\b/i,
  /\bfirst look\b/i,
] as const;

const PATCH_NOTES_MIRROR_PATTERN = /\bpatch notes?\b/i;

const BROAD_CONTENT_PATTERNS = [
  /\bpatch notes?\b/i,
  /\breview\b/i,
  /\bbenchmark\b/i,
  /\bperformance test\b/i,
  /\bperformance fixes?\b/i,
  /\bhow to fix\b/i,
  /\bfix (?:lag|stutter|stuttering|fps|low fps)\b/i,
  /\btroubleshooting\b/i,
  /\bsettings guide\b/i,
  /\bgameplay\b/i,
  /\btrailer\b/i,
  /\bwalkthrough\b/i,
  /\bfirst look\b/i,
  // Wiki and guide roundups ("Added: Glitches & Exploits – 2.03.02 Bugs") list
  // other people's findings; they are not one player's report. The roundup shape
  // decides, not an "Updated:" prefix a player's own thread can carry.
  /\bglitch(?:es)?\s*(?:&|and)\s*exploits?\b/i,
] as const;

const PATCH_RELEASE_TITLE_PATTERNS = [
  /\b(?:patch|hotfix|update)\b.{0,80}\b(?:released|detailed|full notes?|update notes?|release notes?)\b/i,
] as const;

const UNSUPPORTED_SOURCE_CONTEXT_PATTERNS = [
  /\bcrackwatch\b/i,
  /\bdenuvoowo\b/i,
  /\bhypervisor\b.{0,40}\bdenuvoowo\b/i,
  /\bdenuvoowo\b.{0,40}\bhypervisor\b/i,
  /\bhypervisor\s+bypass\b/i,
  /\b(?:repacks?|pirat(?:e|ing|ed|es)|rin forum|clean steam files)\b/i,
] as const;

// Negation wrapper for the SAME bare nouns the symptom list recognizes — when a
// noun joins SYMPTOM_PATTERNS as a standalone matcher, its negated form must be
// recognized here or "runs with no <noun>" reads as a complaint.
const NO_ISSUE_NOUN = String.raw`(?:issues?|bugs?|crashes?|problems?|errors?|glitch(?:es)?|stutters?(?:ing)?|lag|artifacts?|ghosting|flicker(?:ing)?|(?:frame|fps) ?drops?|hitch(?:es|ing)?|freez(?:es|ing)|screen tearing|pop.?in)`;
const NO_ISSUE_NOUN_SERIES = String.raw`${NO_ISSUE_NOUN}(?:\s*(?:[,/]\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)${NO_ISSUE_NOUN})*`;
// "Never crashed until 2.03.02" and "no crashes before this update" say the
// problem started afterward, so a following until/before/prior to undoes the praise.
const UNTIL_THEN = String.raw`(?!\s+(?:until|till|before|prior\s+to)\b)`;
// Praise in Steam reviews: "smooth 4K, no artifacts", "zero crashes", "not a
// single stutter", "never crashed once".
const NO_ISSUE_PATTERNS = [
  new RegExp(String.raw`\bno (?:reported |known )?${NO_ISSUE_NOUN_SERIES}\b${UNTIL_THEN}`, "i"),
  new RegExp(String.raw`\bwithout (?:reported |known |any )?${NO_ISSUE_NOUN_SERIES}\b${UNTIL_THEN}`, "i"),
  new RegExp(String.raw`\bzero ${NO_ISSUE_NOUN_SERIES}\b${UNTIL_THEN}`, "i"),
  new RegExp(String.raw`\bnot (?:a|one) single ${NO_ISSUE_NOUN}\b${UNTIL_THEN}`, "i"),
  new RegExp(String.raw`\bnever (?:once )?(?:(?:had|got|saw|seen|noticed|experienced) (?:a |an |any |one )?)?(?:crash(?:ed)?|froze|stuttered|lagged|${NO_ISSUE_NOUN_SERIES})(?: once)?\b${UNTIL_THEN}`, "i"),
  ...multilingualNoIssuePatterns(),
] as const;

/**
 * The same praise in the languages the symptom list reads, so "Keine
 * Abstürze", "Aucun plantage" or "バグがない" is not mistaken for a report the
 * moment its symptom word is recognized.
 */
function multilingualNoIssuePatterns(): RegExp[] {
  const lettered = [
    // German
    String.raw`(?:kein|keine|keinen|keinerlei|ohne)\s+(?:\p{L}+\s+)?(?:abst(?:ü|ue)rz\p{L}*|absturz|ruckler|ruckeln|bugs?|fehler|probleme?)`,
    // French
    String.raw`(?:aucun|aucune|pas\s+de|pas\s+un\s+seul|sans)\s+(?:\p{L}+\s+)?(?:plantages?|bugs?|crash(?:es)?|saccades?|freezes?|probl[èe]mes?|erreurs?)`,
    // Spanish
    String.raw`(?:ning[úu]n|ninguna|sin|cero|no\s+hay)\s+(?:\p{L}+\s+)?(?:crash(?:es|eos)?|cierres?|congelamientos?|tirones|bugs?|errores?|problemas?)`,
    // Portuguese
    String.raw`(?:nenhum|nenhuma|sem|zero|n[ãa]o\s+tem)\s+(?:\p{L}+\s+)?(?:crash(?:es)?|travamentos?|bugs?|erros?|problemas?)`,
    // Russian
    String.raw`(?:нет|без|никаких|ни\s+одного|ни\s+одной|ноль)\s+(?:\p{L}+\s+)?(?:вылет\p{L}*|краш\p{L}*|баг\p{L}*|фриз\p{L}*|лаг\p{L}*|ошиб\p{L}*|проблем\p{L}*)`,
    // Turkish puts the "none" after the noun: "hiç çökme yok", "hata yok".
    String.raw`(?:hiç\s+)?(?:çökme|hata|bug|takılma|kasma|donma|sorun)\p{L}*\s+(?:yok|olmadı|yaşamadım)`,
    String.raw`sorunsuz`,
    // Polish
    String.raw`(?:bez|zero|żadnych|żadnego)\s+(?:\p{L}+\s+)?(?:crash\p{L}*|błęd\p{L}*|bug\p{L}*|zacię\p{L}*|przycię\p{L}*|problem\p{L}*)`,
    // Italian
    String.raw`(?:nessun|nessuna|zero|senza)\s+(?:\p{L}+\s+)?(?:crash|bug|errori?|problem[ai]|scatti|blocchi)`,
  ];
  // As in English, "Keine Abstürze bis zum Patch" or "Aucun plantage avant cette
  // mise à jour" says the problem started afterward: an until/before word right
  // after the phrase undoes the praise.
  const untilThen = String.raw`(?!\s+(?:bis|vor|avant|jusqu|hasta|antes|até|ate|до|перед|przed|do|fino|prima|kadar|önce)(?![\p{L}\p{N}]))`;
  return [
    new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${lettered.join("|")})(?![\p{L}\p{N}])${untilThen}`, "iu"),
    // Japanese, Chinese and Korean put the negation after or before the noun with
    // no spacing, and the until/before word comes first ("更新之前没有闪退").
    /(?<!まで(?:は)?|前(?:は)?)(?:バグ|クラッシュ|フリーズ|エラー|強制終了)(?:は|も|が)?(?:一切|一度も)?(?:ない|無い|なし|無し|ありません|なかった)/u,
    /(?<!之前|以前|前)(?:没有|沒有|无|無|零)(?:任何)?(?:闪退|閃退|崩溃|崩潰|卡顿|卡頓|bug|BUG|报错|報錯|掉帧|掉幀)/u,
    /(?<!전에는\s?|전엔\s?|까지는\s?)(?:버그|튕김|크래시|렉|끊김|오류|에러)(?:가|이|는|도)?\s*(?:전혀\s*)?없/u,
  ];
}

const CLAIMED_FIX_PATTERNS = [
  /\bfix(?:es|ed) an issue where\b/i,
  /\bfix(?:es|ed) a bug where\b/i,
  /\bimproved an issue where\b/i,
  /\ban issue where\b.{0,80}\b(?:has been|was)\s+fixed\b/i,
] as const;

const CLAIMED_FIXED_SYMPTOM_PATTERNS = [
  /\bfix(?:es|ed)?\s+(?:a\s+)?(?:bug\s+|issue\s+)?(?:with\s+|for\s+)?(?:broken|missing|lost|muted|silent)\b.{0,40}\b(?:audio|sound|music|voice(?:s| lines?)?|sfx|rendering|lighting|shadows?|visuals?|pop.?in)\b/i,
] as const;

const FIX_PERSISTENCE_CUES = [
  /\bstill\b/i,
  /\bpersists?\b/i,
  /\bnot fixed\b/i,
  /\bunfixed\b/i,
  /\beven after\b/i,
  /\bagain\b/i,
  /\b(?:is|are|was|were|came|comes|has come|have come)\s+back\b(?!\s+(?:to|from)\b)/i,
  /\bdoesn'?t (?:fix|work|help)\b/i,
  /\bdidn'?t (?:fix|work|help)\b/i,
  /\bno better\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:audio|sound|music|voice(?:s| lines?)?|sfx|rendering|lighting|shadows?|visuals?|pop.?in)\b.{0,40}\b(?:broken|missing|lost|muted|silent|bugged|glitch(?:y|es|ing)?|wrong|bad|worse)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:broken|missing|lost|muted|silent|bugged|glitch(?:y|es|ing)?|wrong|bad|worse)\b.{0,40}\b(?:audio|sound|music|voice(?:s| lines?)?|sfx|rendering|lighting|shadows?|visuals?|pop.?in)\b/i,
  /\bsupposed(?:ly)? fixed\b/i,
] as const;

const CRASH_FREEZE_HANG_TERMS = String.raw`(?:crash(?:es|ed|ing)?|crash-to-desktop|ctd|freez(?:e|es|ing)?|hang(?:s|ing)?)`;
const CRASH_FREEZE_HANG_SERIES = String.raw`${CRASH_FREEZE_HANG_TERMS}(?:\s*(?:[,/]\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)${CRASH_FREEZE_HANG_TERMS})*`;
const CRASH_FREEZE_HANG_FIX_LIST = new RegExp(
  String.raw`\b(?:(?:${CRASH_FREEZE_HANG_SERIES})\s+fix(?:es)?|fix(?:es|ed)?\s+(?:a\s+)?(?:bug\s+|issue\s+)?(?:with\s+|for\s+)?(?:${CRASH_FREEZE_HANG_SERIES})(?:\s+issues?)?)\b`,
  "i",
);
const CONTRAST_CUE = /\b(?:but|however|though|although|yet|despite)\b/i;
const STUTTER_HITCH_COMPLAINT = /\b(?:stutters|stuttering|hitches|hitching)\b(?!\s+(?:is|was|got|gets|reduced|fixed|gone|improved|better|less))\b/i;
// ONE comprehensive "advertised as fixed" stripper, covering every symptom family the
// keep-path (SYMPTOM_PATTERNS) recognizes. It removes a fix VERB bound to a SYMPTOM noun
// through GLUE ONLY — determiners, "bug/issue", with/for, an adjective — never a causal
// word ("caused"/"where"/"made") and never across a clause. That tightness is the safety:
//   - a COMPLAINT keeps its symptom ("the fixes CAUSE fps drops", "but audio is broken",
//     "improvements LEFT npcs missing"): a non-glue word sits between any fix verb and the
//     symptom, so nothing is stripped;
//   - a PATCH NOTE loses its advertised symptom ("fixes a black screen", "fix for missing
//     NPCs", "reduces the fps drops") and is then correctly seen as an announcement.
// Noun-list completeness only affects false-KEEPS (harmless — the promotion guard is the
// real precision boundary), never false-drops, so erring broad here is safe. Crash/freeze/
// hang fix-LISTS (coordination, "fix for crash issues") stay with CRASH_FREEZE_HANG_FIX_LIST.
const FIX_CLAIM_VERB = String.raw`(?:fix(?:es|ed|ing)?|resolv(?:e|es|ed|ing)|address(?:es|ed|ing)?|reduc(?:e|es|ed|ing)|eliminat(?:e|es|ed|ing)|correct(?:s|ed|ing)?)`;
const FIX_CLAIM_GLUE = String.raw`(?:\s+(?:a|an|the|some|any|all|various|multiple|several|numerous|many|reported|known))?(?:\s+(?:bug|bugs|issue|issues|problem|problems|glitch|glitches))?(?:\s+(?:with|for))?(?:\s+(?:a|an|the))?(?:\s+(?:broken|missing|lost|muted|silent|slow|stuck|frozen|glitchy|bugged|black|infinite|input|unresponsive|awful|bad|poor|terrible|horrible|worse))?`;
const FIX_CLAIM_NOUN = String.raw`(?:black ?screens?|infinite (?:load|loading)|stuck (?:on|at) (?:load|loading|boot)|loading times?|frame ?times?(?:\s+spikes?)?|(?:fps|frame ?rates?|framerate)(?:\s+drops?)?|drops?|stutters?|stuttering|hitch(?:es|ing)?|lag(?:s|gy|ging)?|lock ?ups?|locks? up|input locks?|unresponsive(?:ness)?|controls?|artifacts?|ghosting|flicker(?:ing)?|texture ?shimmer|screen tearing|rendering|lighting|shadows?|visuals?|pop.?ins?|audio|sounds?|music|voice(?:s|\s?lines?)?|sfx|quests?|missions?|objectives?|npcs?|cutscenes?|dialogue|softlocks?|performance|errors?|glitch(?:es|ing)?|bugs?|cross[- ]?saves?|saves?|unplayable)`;
// Advertised symptoms arrive as coordinated lists ("fixes numerous bugs, errors
// and glitches") — strip the whole series, or the trailing nouns survive the
// strip and masquerade as a live complaint.
const FIX_CLAIM_NOUN_SERIES = String.raw`${FIX_CLAIM_NOUN}(?:\s*(?:[,/&]\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)${FIX_CLAIM_NOUN})*`;
const FIX_CLAIM_SYMPTOM = new RegExp(String.raw`\b${FIX_CLAIM_VERB}\b${FIX_CLAIM_GLUE}\s+${FIX_CLAIM_NOUN_SERIES}\b`, "i");
const BARE_SYMPTOM_NOUN_FIRST = String.raw`(?:errors?|glitch(?:es)?)`;
const BARE_SYMPTOM_NOUN_FIRST_SERIES = String.raw`${BARE_SYMPTOM_NOUN_FIRST}(?:\s*(?:[,/&]\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)${BARE_SYMPTOM_NOUN_FIRST})*`;
const BARE_SYMPTOM_NOUN_FIRST_FIX_CLAIM = new RegExp(
  String.raw`\b${BARE_SYMPTOM_NOUN_FIRST_SERIES}\s+${FIX_CLAIM_VERB}\b`,
  "i",
);

// Positive marketing/announcement phrasing (a patch "includes/adds/brings a fix", ships
// "performance fixes", "improves/optimizes FPS", targets a "stable N fps"). Positive
// polarity: the snippet is promoting a patch's performance, not reporting a bug.
const FIX_ANNOUNCEMENT_CUES = [
  /\b(?:includes?|adds?|brings?|shipped|rolling out)\b.{0,40}\b(?:performance\s+)?fix(?:es)?\b/i,
  new RegExp(String.raw`\b(?:includes?|adds?|brings?|shipped|rolling out)\b.{0,80}${CRASH_FREEZE_HANG_FIX_LIST.source}`, "i"),
  /\bperformance\s+(?:improvements?|fixes?|optimi[sz]ations?)\b/i,
  /\b(?:improves?|improved|optimi[sz]es?|optimi[sz]ed)\b.{0,40}\b(?:performance|fps|frame\s?rate|framerate)\b/i,
  /\b(?:aims?|aimed)\s+(?:for|to)\b.{0,60}\b(?:performance|fps|frame\s?rate|framerate|smoother|stable|optimi[sz]e|improve)\b/i,
  /\bachiev(?:e|es|ing|ed)\b.{0,40}\b(?:stable\s+)?\d+\s?fps\b/i,
  /\bstable\s+\d+\s?fps\b/i,
  /\bsmoother\s+performance\b/i,
  /\b(?:boosts?|boosted)\s+performance\b/i,
] as const;

// Community asks: request-language the community uses when it WANTS something,
// not when something is broken. Deliberately tight — a pattern here publishes
// (as an observation) without corroboration, so every entry must be
// unambiguous request phrasing.
const COMMUNITY_ASK_PATTERNS = [
  /\bday\s+\d+\s+of\s+asking\b/i,
  /\b(?:please|pls)\s+add\b/i,
  /\bcan we (?:get|have)\b/i,
  /\bwe need\b/i,
  /\bpetition\b/i,
  /\bfeature request\b/i,
  /\bmost requested\b/i,
  /\bwish ?list\b/i,
] as const;

/** Asks older than this are archive threads, not a live community pulse. */
const COMMUNITY_ASK_MAX_AGE_DAYS = 14;

function isFreshEnoughForAsk(sourcePublishedAt: string | null | undefined): boolean {
  if (!sourcePublishedAt) return true; // unknown age: seen-by-search-now is the freshness signal
  const published = new Date(sourcePublishedAt).getTime();
  if (Number.isNaN(published)) return true;
  return Date.now() - published <= COMMUNITY_ASK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function compact(value: string): string {
  // Phone keyboards type "can’t" with a curly apostrophe, which none of the
  // "can't / won't / doesn't" patterns would otherwise see.
  return value.replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasSymptomLanguage(text: string): boolean {
  return matchesAny(text, SYMPTOM_PATTERNS);
}

// Broad-query discovery (e.g. a generic Reddit result) drags in pages about
// entirely different subjects. Source reputation and topic relevance are
// deliberately separate: a trusted host can still carry an unrelated page.
const GAME_CONTEXT_PATTERN = /crimson(?:[\s_-])?desert|pearl\s?abyss|cdguides|红色沙漠|紅色沙漠|붉은사막|クリムゾン\s?デザート/i;
const EXPLICIT_GAME_CONTEXT_PATTERN = /crimson(?:[\s_-])?desert|cdguides|红色沙漠|紅色沙漠|붉은사막|クリムゾン\s?デザート/i;
const KNOWN_GAME_SOURCE_PATTERN = /(?:steamcommunity\.com\/(?:app|games)\/3321460|store\.steampowered\.com\/(?:app|appreviews)\/3321460)(?:[/?#]|$)/i;
const KNOWN_REDDIT_COMMUNITIES = new Set(["crimsondesert", "crimsondesertlife", "cdguides"]);

function redditCommunity(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(?:^|\.)reddit\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/r\/([^/]+)/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function hasCrimsonDesertContext(
  input: Pick<CandidatePreScreenInput, "title" | "snippet" | "url" | "sourceDomain">,
): boolean {
  const url = input.url ?? "";
  if (KNOWN_GAME_SOURCE_PATTERN.test(url)) return true;

  const community = redditCommunity(url);
  if (community) {
    // Search snippets can quote or splice text from a different Reddit result.
    // An unrelated subreddit therefore needs the game in its own title; the
    // snippet alone cannot turn r/PUBATTLEGROUNDS into Crimson Desert context.
    return KNOWN_REDDIT_COMMUNITIES.has(community) || EXPLICIT_GAME_CONTEXT_PATTERN.test(input.title);
  }

  const context = `${input.title} ${input.snippet} ${url}`;
  if (GAME_CONTEXT_PATTERN.test(context)) return true;

  // The scanner and every persisted row carry a URL, so real intake always
  // takes the strict path above. Keep URL-less trusted-provider inputs usable
  // for direct classifier calls and historical fixtures that cannot establish
  // page context on their own.
  return !input.url && domainTier(input.sourceDomain) === "trusted";
}

function saysNoIssue(text: string): boolean {
  if (!matchesAny(text, NO_ISSUE_PATTERNS)) return false;
  // Keep each pattern's own flags: the multilingual ones need "u" for \p{L}.
  const withoutNoIssueCopy = NO_ISSUE_PATTERNS.reduce(
    (value, pattern) => value.replace(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`), " "),
    text,
  );
  return !hasComplaintSymptom(withoutNoIssueCopy);
}

function isBroadContentTitle(title: string): boolean {
  return matchesAny(title, BROAD_CONTENT_PATTERNS);
}

function isPatchReleaseTitle(title: string): boolean {
  return matchesAny(title, PATCH_RELEASE_TITLE_PATTERNS);
}

export function hasUnsupportedSourceContext(
  input: Pick<CandidatePreScreenInput, "title" | "snippet" | "url">,
): boolean {
  const sourceText = compact(`${input.title} ${input.snippet}`);
  const url = input.url ?? "";
  return matchesAny(`${sourceText} ${url}`, UNSUPPORTED_SOURCE_CONTEXT_PATTERNS);
}

function isClaimedFixNotReport(text: string): boolean {
  const isClaimedFixedSymptomAnnouncement =
    matchesAny(text, FIX_ANNOUNCEMENT_CUES) && matchesAny(text, CLAIMED_FIXED_SYMPTOM_PATTERNS);

  return (
    (matchesAny(text, CLAIMED_FIX_PATTERNS) || isClaimedFixedSymptomAnnouncement) &&
    !matchesAny(text, FIX_PERSISTENCE_CUES) &&
    !hasPostContrastSymptomComplaint(text)
  );
}

// Remove the announcement's OWN fix-claim copy (a patch "fixes crashes", "fix for
// broken audio", "reduces the fps drops") so those advertised symptom words are not
// mistaken for a complaint. Whatever symptom survives the strip is being reported, not
// advertised as fixed.
function stripFixClaimCopy(text: string): string {
  return text
    .replace(new RegExp(CRASH_FREEZE_HANG_FIX_LIST.source, "gi"), " ")
    .replace(new RegExp(FIX_CLAIM_SYMPTOM.source, "gi"), " ")
    .replace(new RegExp(BARE_SYMPTOM_NOUN_FIRST_FIX_CLAIM.source, "gi"), " ");
}

// A real complaint is present iff, after stripping fix-claim copy, the text still
// matches the SINGLE shared SYMPTOM_PATTERNS list (the same list the keep-path uses).
// This is the whole polarity check — there is no second, hand-maintained cue list to
// keep in sync, which is what caused this gate to leak real complaints one symptom at
// a time.
function hasComplaintSymptom(text: string): boolean {
  const withoutFixClaims = stripFixClaimCopy(text);
  return hasSymptomLanguage(withoutFixClaims) || STUTTER_HITCH_COMPLAINT.test(withoutFixClaims);
}

function hasPostContrastSymptomComplaint(text: string): boolean {
  const [, ...tails] = text.split(CONTRAST_CUE);
  return tails.some((tail) => hasComplaintSymptom(tail));
}

// Fires ONLY on text that matches a FIX_ANNOUNCEMENT_CUE and carries no complaint.
// "Complaint" has ONE definition here — the shared SYMPTOM_PATTERNS list, via
// hasComplaintSymptom — so any symptom the keep-path recognizes anywhere in the text
// also rescues it here; there is no separate polarity list to fall out of sync (that
// mismatch was the root cause of this gate repeatedly dropping real reports).
// FIX_PERSISTENCE_CUES additionally rescues "still / again / no better / doesn't work"
// failures that carry no fresh symptom noun. A bare "Patch X fixes the fps drops"
// matches no announcement cue and is intentionally left to the per-signal promotion
// guard (resolveSignalPublicStatus / direct_report_match credibility), the backstop for
// announcement-style phrasings that slip past this cheap, recall-biased pre-screen.
function isFixAnnouncement(text: string): boolean {
  return (
    matchesAny(text, FIX_ANNOUNCEMENT_CUES) &&
    !matchesAny(text, FIX_PERSISTENCE_CUES) &&
    !hasComplaintSymptom(text)
  );
}

/**
 * Cheap gate on raw source text. Runs BEFORE any LLM call.
 *
 * Trade-off: a source whose raw title+snippet has no symptom language is rejected
 * WITHOUT giving the LLM a chance to rescue it. That rescue path was the waste this
 * split exists to remove — most candidates a free regex would kill never needed an
 * LLM call in the first place.
 */
export function preScreenCandidate(
  input: CandidatePreScreenInput,
  options: { currentPatchVersion: string; currentPatchPublishedAt?: string | null },
): SignalRelevanceDecision {
  const sourceText = compact(`${input.title} ${input.snippet}`);
  if (!hasCrimsonDesertContext(input)) {
    return { keep: false, reason: "off_topic" };
  }
  if (hasUnsupportedSourceContext(input)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  if (mentionsOnlyOtherPatch(sourceText, options.currentPatchVersion)) {
    return { keep: false, reason: "wrong_patch" };
  }
  const patchEligibility = evaluateCurrentPatchEligibility(
    {
      title: input.title,
      snippet: input.snippet,
      sourcePublishedAt: input.sourcePublishedAt,
      sourceActiveAt: input.sourceActiveAt,
    },
    { version: options.currentPatchVersion, publishedAt: options.currentPatchPublishedAt ?? null },
  );
  if (!patchEligibility.canStore) {
    return { keep: false, reason: patchEligibility.reason === "wrong_patch" ? "wrong_patch" : "stale_source" };
  }
  // Community asks are patch-AGNOSTIC in content — a request names no version —
  // but they are not exempt from the patch gates. They run AFTER off-topic,
  // unrelated-subreddit, wrong-patch, verified pre-era date and current-patch
  // eligibility, because an ask published before this patch, or explicitly tied
  // to an older one, is an archive thread and must not be published as part of
  // the current patch's conversation. Being ahead of those gates is exactly how
  // "day 40 of asking" threads from a previous patch reached the live lane.
  //
  // A campaign about a BUG ("day 20 of asking to fix the crashes") carries
  // symptom language and falls through to the normal complaint path — the ask
  // lane only takes pure requests.
  if (
    matchesAny(sourceText, COMMUNITY_ASK_PATTERNS) &&
    !hasComplaintSymptom(sourceText) &&
    isFreshEnoughForAsk(input.sourcePublishedAt)
  ) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "community_ask" };
  }
  if (
    isPatchReleaseTitle(input.title) &&
    !matchesAny(sourceText, FIX_PERSISTENCE_CUES) &&
    !hasComplaintSymptom(sourceText)
  ) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "patch_release" };
  }
  if (isBroadContentTitle(input.title)) {
    return {
      keep: false,
      reason: "source_not_issue_report",
      observationKind: PATCH_NOTES_MIRROR_PATTERN.test(input.title)
        ? "patch_release"
        : matchesAny(input.title, PRESS_RECEPTION_PATTERNS)
          ? "press_reception"
          : undefined,
    };
  }
  if (isClaimedFixNotReport(sourceText)) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "fix_announcement" };
  }
  if (isFixAnnouncement(sourceText)) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "fix_announcement" };
  }
  if (!hasSymptomLanguage(sourceText) || saysNoIssue(sourceText)) {
    const languageReview = !saysNoIssue(sourceText)
      && !isOfficialDomain(input.sourceDomain)
      // Title and snippet are judged apart: a foreign title can come with an
      // English search summary, and a Steam review's placeholder title is English.
      && (isMostlyNonEnglish(input.title) || isMostlyNonEnglish(input.snippet));
    return { keep: false, reason: "source_not_issue_report", ...(languageReview ? { languageReview: true as const } : {}) };
  }
  // The publisher's own pages are provider context, never player evidence. A
  // known-issues list reaches this point carrying the same symptom nouns as a
  // complaint — and a patch-notes title that LISTS live issues skips the
  // patch_release route above for the same reason — but an official
  // acknowledgment must not create a cluster or corroborate one. It is still
  // worth showing, so it routes to the patch_release observation lane instead
  // of being kept.
  if (isOfficialDomain(input.sourceDomain)) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "patch_release" };
  }
  return { keep: true };
}

/** Post-extraction gate. Runs AFTER extraction (deterministic or LLM). */
export function shouldKeepExtractedSignal(
  extraction: ExtractionResult,
  sourceText?: string,
): SignalRelevanceDecision {
  if (extraction.category === "other") {
    // A real complaint with no category keyword (cross-save failures, boss-fight
    // bugs) still deserves tracking under "other" — this gate exists to drop
    // non-complaints, not uncategorizable complaints. "Complaint" keeps its ONE
    // definition: the shared SYMPTOM_PATTERNS list via hasComplaintSymptom,
    // with the same no-issue negation guard the pre-screen applies.
    const text = compact(sourceText ?? `${extraction.issueTitle} ${extraction.summary}`);
    if (hasComplaintSymptom(text) && !saysNoIssue(text)) return { keep: true };
    return { keep: false, reason: "category_other" };
  }
  return { keep: true };
}
