import { belongsToPatchFamily } from "@/lib/patchWatch";

export type CurrentPatchContext = {
  version: string;
  publishedAt: string | null;
};

export type SourceFreshnessInput = {
  title?: string | null;
  summary?: string | null;
  snippet?: string | null;
  sourcePublishedAt?: string | null;
  /**
   * The latest activity the source itself shows, such as a forum thread's last
   * reply. It never replaces the publication date: an older thread that is
   * still active after the patch may be stored as a lead, never published on
   * this alone.
   */
  sourceActiveAt?: string | null;
};

export type CurrentPatchEligibilityReason =
  | "current_patch"
  | "fresh_source"
  | "fresh_language"
  | "unknown_source_freshness"
  | "active_after_patch"
  | "wrong_patch"
  | "stale_source";

export type CurrentPatchEligibility = {
  canStore: boolean;
  canPublish: boolean;
  reason: CurrentPatchEligibilityReason;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizePatchVersion(value: string): string {
  return value.replace(/(?:\.0+)+$/g, "");
}

/** Keep full source versions: exact-patch counts must distinguish 1.13 from 1.13.00. */
export function extractSourcePatchVersions(text: string): string[] {
  const versions: string[] = [];
  const patterns = [
    /\b(?:patch|update|hotfix|v)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(?:patch\s+notes?|hotfix)\s+(?:notes?\s+)?version\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\bversion\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\s*(?:patch|update|hotfix)\b/gi,
    /\b(?:after|since|on)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(\d+\.\d{1,2}(?:\.\d{1,2})?)\s*(?:patch|update|hotfix)\b/gi,
  ] as const;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) versions.push(match[1]);
    }
  }
  return [...new Set(versions)];
}

export function explicitPatchVersions(text: string): string[] {
  return [...new Set(extractSourcePatchVersions(text).map(normalizePatchVersion))];
}

/** Rebuild freshness evidence from source-derived facts, never an AI paraphrase. */
export function storedSourceFreshnessInput(row: {
  title?: string | null;
  summary?: string | null;
  source_published_at?: string | null;
  extracted_facts?: unknown;
}): SourceFreshnessInput {
  const facts = row.extracted_facts;
  let summary = row.summary ?? null;
  if (facts && typeof facts === "object" && "sourcePatchVersions" in facts) {
    const versions = facts.sourcePatchVersions;
    // An empty list records that the source mentioned no patch. Malformed
    // stored proof must not fall back to potentially invented summary claims.
    summary = Array.isArray(versions) && versions.every(
      (version): version is string => typeof version === "string" && /^\d+\.\d{1,2}(?:\.\d{1,2})?$/.test(version),
    ) ? versions.map((version) => `patch ${version}`).join(" ") : null;
  }
  // Legacy rows retain their existing read path until a normal re-observation
  // stores source proof. The original asserted date is never refreshed here.
  return {
    title: row.title ?? null,
    summary,
    sourcePublishedAt: row.source_published_at ?? null,
    sourceActiveAt: storedSourceActiveAt(facts),
  };
}

/** A stored last-activity time counts only when it is a readable timestamp. */
export function storedSourceActiveAt(facts: unknown): string | null {
  if (!facts || typeof facts !== "object" || !("sourceActiveAt" in facts)) return null;
  const value = facts.sourceActiveAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function mentionsOnlyOtherPatch(text: string, currentPatchVersion: string): boolean {
  const versions = explicitPatchVersions(text);
  if (versions.length === 0) return false;
  return versions.every((version) => !belongsToPatchFamily(version, currentPatchVersion));
}

function mentionsCurrentPatch(text: string, currentPatchVersion: string): boolean {
  return explicitPatchVersions(text).some((version) => belongsToPatchFamily(version, currentPatchVersion));
}

function mentionsCurrentPatchWindow(text: string): boolean {
  return /\b(?:after|since|on|with)\s+(?:today'?s|latest|new|current)\s+(?:patch|update|hotfix)\b/i.test(text)
    || /\b(?:today'?s|latest|new|current)\s+(?:patch|update|hotfix)\b/i.test(text);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isDateOnly(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function dateOnlyIsBefore(sourceDate: string, patchTime: number): boolean {
  return sourceDate < new Date(patchTime).toISOString().slice(0, 10);
}

function dateOnlyIsOnOrAfter(sourceDate: string, patchTime: number): boolean {
  return sourceDate >= new Date(patchTime).toISOString().slice(0, 10);
}

export function evaluateCurrentPatchEligibility(
  input: SourceFreshnessInput,
  currentPatch: CurrentPatchContext,
): CurrentPatchEligibility {
  const sourceText = compact(`${input.title ?? ""} ${input.summary ?? ""} ${input.snippet ?? ""}`);
  if (mentionsOnlyOtherPatch(sourceText, currentPatch.version)) {
    return { canStore: false, canPublish: false, reason: "wrong_patch" };
  }

  if (mentionsCurrentPatch(sourceText, currentPatch.version)) {
    return { canStore: true, canPublish: true, reason: "current_patch" };
  }

  // `sourcePublishedAt` is a date this source ASSERTED — see
  // lib/automation/sourceDate.ts, which resolves it before any caller reaches
  // here. This function never reads a date out of prose: a month/day sitting
  // somewhere in a snippet says nothing about when the page was published, and
  // treating it as a publication date is how unrelated pages used to acquire
  // current-patch freshness.
  const sourcePublishedDateOnly = isDateOnly(input.sourcePublishedAt) ? input.sourcePublishedAt : null;
  const sourcePublishedAt = parseTime(input.sourcePublishedAt);
  const patchPublishedAt = parseTime(currentPatch.publishedAt);
  if (
    sourcePublishedAt !== null &&
    patchPublishedAt !== null &&
    (sourcePublishedDateOnly
      ? dateOnlyIsBefore(sourcePublishedDateOnly, patchPublishedAt)
      : sourcePublishedAt < patchPublishedAt)
  ) {
    // A thread opened before the patch but still answered after it is a live
    // discussion, not an archive page. It is kept as a lead; whether the
    // problem persists on this patch is not known from activity alone.
    const sourceActiveAt = parseTime(input.sourceActiveAt);
    if (sourceActiveAt !== null && sourceActiveAt >= patchPublishedAt && sourceActiveAt >= sourcePublishedAt) {
      return { canStore: true, canPublish: false, reason: "active_after_patch" };
    }
    return { canStore: false, canPublish: false, reason: "stale_source" };
  }

  if (
    sourcePublishedAt !== null &&
    (patchPublishedAt === null ||
      sourcePublishedAt >= patchPublishedAt ||
      (sourcePublishedDateOnly !== null && dateOnlyIsOnOrAfter(sourcePublishedDateOnly, patchPublishedAt)))
  ) {
    return { canStore: true, canPublish: true, reason: "fresh_source" };
  }

  if (mentionsCurrentPatchWindow(sourceText)) {
    return { canStore: true, canPublish: false, reason: "fresh_language" };
  }

  return { canStore: true, canPublish: false, reason: "unknown_source_freshness" };
}
