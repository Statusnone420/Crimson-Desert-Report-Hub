import type { ExtractionResult } from "@/lib/automation/extract";
import { evaluateCurrentPatchEligibility, mentionsOnlyOtherPatch } from "@/lib/automation/eligibility";
import { CURRENT_PATCH } from "@/lib/constants";

export type RelevanceSkipReason = "category_other" | "source_not_issue_report" | "wrong_patch" | "stale_source";

export type SignalRelevanceDecision = { keep: true } | { keep: false; reason: RelevanceSkipReason };

export type CandidatePreScreenInput = {
  title: string;
  snippet: string;
  sourceDomain: string | null;
  sourcePublishedAt?: string | null;
};

const SYMPTOM_PATTERNS = [
  /\b(?:fps|frame ?rate|framerate|performance mode)\b.{0,60}\b(?:drop|drops|dropped|low|lower|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:drop|drops|dropped|low|lower|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b.{0,60}\b(?:fps|frame ?rate|framerate)\b/i,
  /\b(?:fps|frame ?rate|framerate)\b.{0,60}\b(?:after|since|caused by|from)\b.{0,40}\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made)\b.{0,40}\b(?:fps|frame ?rate|framerate|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:stutters|stuttering|hitches|hitching)\b(?!\s+(?:is|was|got|gets|reduced|fixed|gone|improved|better|less))\b/i,
  /\bloading times?\b.{0,50}\b(?:slow|slower|long|longer|worse|awful|bad|broken|regress|regression|increased|doubl(?:e[sd]?|ing))\b/i,
  /\b(?:slow|slower|long|longer|worse|awful|bad|broken|increased|doubl(?:e[sd]?|ing))\b.{0,50}\bloading times?\b/i,
  /\bframe ?time\b.{0,50}\b(?:spike|spikes|spiking|stutter|stutters|stuttering|bad|worse|regress|regression)\b/i,
  /\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b.{0,50}\bperformance\b/i,
  /\bperformance\b.{0,50}\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b/i,
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
] as const;

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

const NO_ISSUE_PATTERNS = [
  /\bno (?:reported |known )?(?:issues?|bugs?|crashes?|problems?)\b/i,
  /\bwithout (?:reported |known )?(?:issues?|bugs?|crashes?|problems?)\b/i,
] as const;

const CLAIMED_FIX_PATTERNS = [
  /\bfixed an issue where\b/i,
  /\bfixed a bug where\b/i,
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
// Marketing "fixed/reduced the <perf symptom>" copy. Stripped before symptom detection
// so a patch that ADVERTISES fixing fps drops/stutter (e.g. "fixes the fps drops",
// "reduces stutters") is not misread as a complaint ABOUT them. Complaint phrasings put
// the symptom in effect position ("fps drops in combat", "caused fps drops") with no
// leading fix verb, so they survive the strip. Mirrors the crash/freeze/hang fix-list
// and "fix for broken audio/rendering" strippers for the performance symptom family.
const PERF_SYMPTOM_FIX =
  /\b(?:fix(?:es|ed)?|reduc(?:e|es|ed))\s+(?:the\s+|a\s+)?(?:(?:fps|frame ?rate|framerate)\s+)?(?:drops?|stutters?|stuttering|hitch(?:es|ing)?|frame ?time\s+spikes?)\b/i;
// Tight "fix for broken audio/rendering" marketing copy, for STRIPPING only. Unlike the
// matcher CLAIMED_FIXED_SYMPTOM_PATTERNS (which allows a loose gap to DETECT the phrase),
// the stripper must not span a contrast clause — a greedy gap would swallow the real
// complaint after "but" (e.g. "fix for broken audio, but no sound"). The advertised
// phrase is always tight ("broken audio"), so require the noun to follow immediately.
const CLAIMED_FIXED_SYMPTOM_FIX =
  /\bfix(?:es|ed)?\s+(?:a\s+)?(?:bug\s+|issue\s+)?(?:with\s+|for\s+)?(?:broken|missing|lost|muted|silent)\s+(?:audio|sound|music|voice(?:s| lines?)?|sfx|rendering|lighting|shadows?|visuals?|pop.?in)\b/i;

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

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasSymptomLanguage(text: string): boolean {
  return matchesAny(text, SYMPTOM_PATTERNS);
}

function saysNoIssue(text: string): boolean {
  return matchesAny(text, NO_ISSUE_PATTERNS);
}

function isBroadContentTitle(title: string): boolean {
  return matchesAny(title, BROAD_CONTENT_PATTERNS);
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
    .replace(new RegExp(CLAIMED_FIXED_SYMPTOM_FIX.source, "gi"), " ")
    .replace(new RegExp(PERF_SYMPTOM_FIX.source, "gi"), " ");
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
  if (isBroadContentTitle(input.title)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  if (isClaimedFixNotReport(sourceText)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  if (isFixAnnouncement(sourceText)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  if (!hasSymptomLanguage(sourceText) || saysNoIssue(sourceText)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  return { keep: true };
}

/** Post-extraction gate. Runs AFTER extraction (deterministic or LLM). */
export function shouldKeepExtractedSignal(extraction: ExtractionResult): SignalRelevanceDecision {
  if (extraction.category === "other") {
    return { keep: false, reason: "category_other" };
  }
  return { keep: true };
}
