import type { ExtractionResult } from "@/lib/automation/extract";
import { CURRENT_PATCH } from "@/lib/constants";

export type RelevanceSkipReason = "category_other" | "source_not_issue_report" | "wrong_patch";

export type SignalRelevanceDecision = { keep: true } | { keep: false; reason: RelevanceSkipReason };

export type SignalRelevanceInput = {
  title: string;
  snippet: string;
  sourceDomain: string | null;
  extraction: ExtractionResult;
};

const SYMPTOM_PATTERNS = [
  /\b(?:fps|frame ?rate|framerate|performance mode)\b.{0,60}\b(?:drop|drops|dropped|low|lower|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b/i,
  /\b(?:drop|drops|dropped|low|lower|regress|regression|stutter|stutters|stuttering|hitch|hitching)\b.{0,60}\b(?:fps|frame ?rate|framerate)\b/i,
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

function normalizePatch(value: string): string {
  return value.replace(/(?:\.0+)+$/g, "");
}

function explicitPatchVersions(text: string): string[] {
  const versions: string[] = [];
  const patterns = [
    /\b(?:patch|update|v)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(\d+\.\d{1,2}(?:\.\d{1,2})?)\s*(?:patch|update)\b/gi,
  ] as const;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) versions.push(normalizePatch(match[1]));
    }
  }
  return [...new Set(versions)];
}

function mentionsOnlyOtherPatch(text: string, currentPatchVersion: string): boolean {
  const versions = explicitPatchVersions(text);
  if (versions.length === 0) return false;
  return !versions.includes(normalizePatch(currentPatchVersion));
}

export function shouldKeepAutomatedSignal(
  input: SignalRelevanceInput,
  options: { currentPatchVersion?: string } = {},
): SignalRelevanceDecision {
  if (input.extraction.category === "other") {
    return { keep: false, reason: "category_other" };
  }

  const sourceText = compact(`${input.title} ${input.snippet}`);
  const extractionText = compact(`${input.extraction.issueTitle} ${input.extraction.summary}`);
  if (mentionsOnlyOtherPatch(sourceText, options.currentPatchVersion ?? CURRENT_PATCH)) {
    return { keep: false, reason: "wrong_patch" };
  }

  const sourceHasSymptom = hasSymptomLanguage(sourceText);
  const extractionHasSymptom = hasSymptomLanguage(extractionText) && !saysNoIssue(extractionText);

  if (isBroadContentTitle(input.title)) {
    return { keep: false, reason: "source_not_issue_report" };
  }

  if (!sourceHasSymptom && !extractionHasSymptom) {
    return { keep: false, reason: "source_not_issue_report" };
  }

  if (input.extraction.extractionProvider === "deterministic" && !sourceHasSymptom) {
    return { keep: false, reason: "source_not_issue_report" };
  }

  return { keep: true };
}
