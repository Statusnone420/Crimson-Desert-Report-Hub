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

// Positive marketing/announcement phrasing (a patch "includes/adds/brings a fix", ships
// "performance fixes", "improves/optimizes FPS", targets a "stable N fps"). Positive
// polarity: the snippet is promoting a patch's performance, not reporting a bug.
const FIX_ANNOUNCEMENT_CUES = [
  /\b(?:includes?|adds?|brings?|shipped|rolling out)\b.{0,40}\b(?:performance\s+)?fix(?:es)?\b/i,
  /\bperformance\s+(?:improvements?|fixes?|optimi[sz]ations?)\b/i,
  /\b(?:improves?|improved|optimi[sz]es?|optimi[sz]ed)\b.{0,40}\b(?:performance|fps|frame\s?rate|framerate)\b/i,
  /\b(?:aims?|aimed)\s+(?:for|to)\b.{0,60}\b(?:performance|fps|frame\s?rate|framerate|smoother|stable|optimi[sz]e|improve)\b/i,
  /\bachiev(?:e|es|ing|ed)\b.{0,40}\b(?:stable\s+)?\d+\s?fps\b/i,
  /\bstable\s+\d+\s?fps\b/i,
  /\bsmoother\s+performance\b/i,
  /\b(?:boosts?|boosted)\s+performance\b/i,
] as const;

// Complaint markers. If any are present the snippet is a real report, not marketing.
// Covers sentiment words AND crash-class symptom verbs, so a complaint that quotes the
// marketing claim then reports a crash/freeze/hang (with no adjective) is preserved.
// Bare fps/drop/stutter cues are deliberately excluded — they also appear in genuine
// positive announcements (e.g. "boosts fps", "smoother performance") that DO match an
// announcement cue and must still be rejected. Contrastive/persistent wording is kept
// below because it is a complaint quoting the announcement copy.
const NEGATIVE_POLARITY_CUES = [
  /\b(?:awful|bad|poor|terrible|horrible|worse|worst|broken|unplayable|ruined|garbage)\b/i,
  /\bstill\s+(?:bad|stutter\w*|crash\w*)\b/i,
  /\bcrash-to-desktop\b/i,
  /\bctd\b/i,
  /\bcrash(?:es|ed|ing)?\b(?!\s+fix(?:es)?\b)/i,
  /\bfreez\w*\b/i,
  /\bhang(?:s|ing)?\b/i,
  /\b(?:not|isn'?t|wasn'?t|aren'?t|weren'?t|never)\s+stable\b/i,
  /\bunstable\b/i,
  /\bstable\s+\d+\s?fps\b.{0,80}\b(?:drop|drops|dropped|low|lower|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:fps|frame ?rate|framerate)\b.{0,40}\b(?:drop|drops|dropped|low|lower|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:drop|drops|dropped|low|lower|stutter|stutters|stuttering|hitch|hitching)\b.{0,40}\b(?:fps|frame ?rate|framerate)\b/i,
  /\b(?:but|however|though|although|yet|despite)\b.{0,80}\b(?:stutters|stuttering|hitches|hitching)\b(?!\s+(?:is|was|got|gets|reduced|fixed|gone|improved|better|less))\b/i,
  /\b(?:fps|frame ?rate|framerate)\b.{0,60}\b(?:drop|drops|dropped|low|lower|stutter|stutters|stuttering|hitch|hitching)\b.{0,80}\b(?:after|since|from)\b.{0,40}\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made)\b.{0,40}\b(?:fps|frame ?rate|framerate|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:no|missing|lost|muted|silent|broken)\s+(?:audio|sound|music|voice(?:s| lines?)?|sfx)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:rendering|lighting|shadows?|visuals?|pop.?in)\b.{0,60}\b(?:missing|broken|bugged|glitch(?:y|es|ing)?|flicker|flickering|wrong|bad|worse|washed out)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:missing|broken|bugged|glitch(?:y|es|ing)?|flicker|flickering|wrong|bad|worse|washed out)\b.{0,60}\b(?:rendering|lighting|shadows?|visuals?|pop.?in)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\bloading times?\b.{0,50}\b(?:slow|slower|long|longer|worse|awful|bad|broken|regress|regression|increased|doubl(?:e[sd]?|ing))\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:slow|slower|long|longer|worse|awful|bad|broken|increased|doubl(?:e[sd]?|ing))\b.{0,50}\bloading times?\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:quests?|missions?|objectives?|npcs?|cutscenes?|dialogue)\b.{0,60}\b(?:stuck|blocked|frozen|missing|broken|bugged|softlock(?:ed)?|cannot progress|can'?t progress|won't complete|will not complete|not progressing|not spawning)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:won't|will not|doesn'?t|does not|can'?t|cannot|not)\s+(?:launch|start|load|progress|complete)\b/i,
  /\b(?:performance\s+)?(?:fixes?|improvements?|optimi[sz]ations?)\b.{0,60}\b(?:caus(?:ed|es?|ing)|introduced|triggered|left|made|broke)\b.{0,60}\b(?:lockup|lockups|locks up|input lock|input locks|unresponsive|controls? (?:stop|stops|stopped|lock|locks|locked|freeze|freezes))\b/i,
  /\bdoesn'?t\s+(?:work|help)\b/i,
  /\bdidn'?t\s+(?:fix|help)\b/i,
  /\bno better\b/i,
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
    !matchesAny(text, FIX_PERSISTENCE_CUES)
  );
}

// Fires ONLY on purely-positive text that MATCHES a FIX_ANNOUNCEMENT_CUE. Any persistence
// cue ("still", "<symptom> is back", "didn't fix") or negative-polarity marker means it is
// a real complaint quoting the marketing claim, so the gate must NOT reject it. This does
// NOT claim to catch every "fixes <symptom>" wording: a bare "Patch X fixes the fps drops"
// matches no announcement cue and is intentionally left to the per-signal promotion guard
// (resolveSignalPublicStatus / direct_report_match credibility), the backstop for
// announcement-style phrasings that slip past this cheap pre-screen.
function isFixAnnouncement(text: string): boolean {
  return (
    matchesAny(text, FIX_ANNOUNCEMENT_CUES) &&
    !matchesAny(text, FIX_PERSISTENCE_CUES) &&
    !matchesAny(text, NEGATIVE_POLARITY_CUES)
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
