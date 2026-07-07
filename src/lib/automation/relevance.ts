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
  /\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b.{0,50}\bperformance\b/i,
  /\bperformance\b.{0,50}\b(?:awful|bad|poor|terrible|horrible|worse|broken)\b/i,
  /\b(?:crash|crashes|crashed|crashing|crash-to-desktop|ctd|freeze|freezes|freezing|hang|hangs|hanging)\b/i,
  /\b(?:lockup|lockups|locks up|input lock|input locks|unresponsive|controls? (?:stop|stops|stopped|locked|freeze|freezes))\b/i,
  /\b(?:artifact|artifacts|ghosting|flicker|flickering|texture shimmer|screen tearing)\b/i,
  /\b(?:won't|will not|doesn't|does not|can't|cannot)\s+(?:launch|start|load|progress|complete)\b/i,
  /\bquest\b.{0,50}\b(?:stuck|blocked|cannot progress|won't complete|will not complete)\b/i,
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

const FIX_PERSISTENCE_CUES = [
  /\bstill\b/i,
  /\bpersists?\b/i,
  /\bnot fixed\b/i,
  /\bunfixed\b/i,
  /\beven after\b/i,
  /\bagain\b/i,
  /\b(?:is|are|was|were|came|comes|has come|have come)\s+back\b(?!\s+(?:to|from)\b)/i,
  /\bdidn'?t (?:fix|work|help)\b/i,
  /\bsupposed(?:ly)? fixed\b/i,
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
  return matchesAny(text, CLAIMED_FIX_PATTERNS) && !matchesAny(text, FIX_PERSISTENCE_CUES);
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
