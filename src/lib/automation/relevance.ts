import type { ExtractionResult } from "@/lib/automation/extract";
import { domainTier, isOfficialDomain } from "@/lib/automation/domains";
import { evaluateCurrentPatchEligibility, mentionsOnlyOtherPatch } from "@/lib/automation/eligibility";
import { CURRENT_PATCH } from "@/lib/constants";

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
  | { keep: false; reason: RelevanceSkipReason; observationKind?: ObservationKind };

export type CandidatePreScreenInput = {
  title: string;
  snippet: string;
  url?: string | null;
  sourceDomain: string | null;
  sourcePublishedAt?: string | null;
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
  /\b(?:rendering|lighting|shadows?|visuals?|pop.?in)\b.{0,60}\b(?:broken|bugged|glitch(?:y|es|ing)?|missing|flicker|flickering|wrong|bad|worse|washed out)\b/i,
  /\b(?:broken|bugged|glitch(?:y|es|ing)?|missing|flicker|flickering|wrong|bad|worse|washed out)\b.{0,60}\b(?:rendering|lighting|shadows?|visuals?|pop.?in)\b/i,
  /\b(?:won't|will not|doesn't|does not|can't|cannot|not)\s+(?:launch|start|load|progress|complete)\b/i,
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
  /\b(?:won't|will not|doesn't|does not|can't|cannot|not|stopped)\s+work(?:ing)?\b/i,
  /\berrors?\b/i,
  /\bglitch(?:es|ed|y|ing)?\b/i,
  /\bstill\s+(?:broken|bugged|glitched|angry|happening|unplayable|not (?:working|fixed))\b/i,
  /\bunplayable\b/i,
  /\b(?:am i the only one|is it just me|anyone else)\b.{0,80}\b(?:problems?|issues?|bugs?|glitch(?:es)?|broken|crash(?:es|ing)?|errors?|not working)\b/i,
  /\b(?:graphical|graphics|visual|texture)\s+(?:problems?|issues?|bugs?)\b/i,
] as const;

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
const NO_ISSUE_NOUN = String.raw`(?:issues?|bugs?|crashes?|problems?|errors?|glitch(?:es)?|stutters?(?:ing)?|lag)`;
const NO_ISSUE_NOUN_SERIES = String.raw`${NO_ISSUE_NOUN}(?:\s*(?:[,/]\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)${NO_ISSUE_NOUN})*`;
const NO_ISSUE_PATTERNS = [
  new RegExp(String.raw`\bno (?:reported |known )?${NO_ISSUE_NOUN_SERIES}\b`, "i"),
  new RegExp(String.raw`\bwithout (?:reported |known |any )?${NO_ISSUE_NOUN_SERIES}\b`, "i"),
] as const;

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
  return value.replace(/\s+/g, " ").trim();
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
const GAME_CONTEXT_PATTERN = /crimson(?:[\s_-])?desert|pearl\s?abyss|cdguides|红色沙漠|붉은사막/i;
const EXPLICIT_GAME_CONTEXT_PATTERN = /crimson(?:[\s_-])?desert|cdguides|红色沙漠|붉은사막/i;
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
  const withoutNoIssueCopy = NO_ISSUE_PATTERNS.reduce(
    (value, pattern) => value.replace(new RegExp(pattern.source, "gi"), " "),
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
  options: { currentPatchVersion?: string; currentPatchPublishedAt?: string | null } = {},
): SignalRelevanceDecision {
  const sourceText = compact(`${input.title} ${input.snippet}`);
  if (!hasCrimsonDesertContext(input)) {
    return { keep: false, reason: "off_topic" };
  }
  if (hasUnsupportedSourceContext(input)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  // Community asks are patch-agnostic, so they are tagged before the patch
  // gates. A campaign about a BUG ("day 20 of asking to fix the crashes")
  // carries symptom language and falls through to the normal complaint path —
  // the ask lane only takes pure requests.
  if (
    matchesAny(sourceText, COMMUNITY_ASK_PATTERNS) &&
    !hasComplaintSymptom(sourceText) &&
    isFreshEnoughForAsk(input.sourcePublishedAt)
  ) {
    return { keep: false, reason: "source_not_issue_report", observationKind: "community_ask" };
  }
  if (mentionsOnlyOtherPatch(sourceText, options.currentPatchVersion ?? CURRENT_PATCH)) {
    return { keep: false, reason: "wrong_patch" };
  }
  const patchEligibility = evaluateCurrentPatchEligibility(
    { title: input.title, snippet: input.snippet, sourcePublishedAt: input.sourcePublishedAt },
    { version: options.currentPatchVersion ?? CURRENT_PATCH, publishedAt: options.currentPatchPublishedAt ?? null },
  );
  if (!patchEligibility.canStore) {
    return { keep: false, reason: patchEligibility.reason === "wrong_patch" ? "wrong_patch" : "stale_source" };
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
    return { keep: false, reason: "source_not_issue_report" };
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
