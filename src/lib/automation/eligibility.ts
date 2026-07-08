import { CURRENT_PATCH } from "@/lib/constants";
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
};

export type CurrentPatchEligibilityReason =
  | "current_patch"
  | "fresh_source"
  | "fresh_language"
  | "unknown_source_freshness"
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

export function explicitPatchVersions(text: string): string[] {
  const versions: string[] = [];
  const patterns = [
    /\b(?:patch|update|v)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(?:after|since|on)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(\d+\.\d{1,2}(?:\.\d{1,2})?)\s*(?:patch|update)\b/gi,
  ] as const;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) versions.push(normalizePatchVersion(match[1]));
    }
  }
  return [...new Set(versions)];
}

export function mentionsOnlyOtherPatch(text: string, currentPatchVersion = CURRENT_PATCH): boolean {
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

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function inferDateOnlyFromText(text: string, currentPatchPublishedAt: string | null): string | null {
  const patchTime = parseTime(currentPatchPublishedAt);
  if (patchTime === null) return null;
  const patchYear = new Date(patchTime).getUTCFullYear();
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i,
  );
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : patchYear;
  if (!month || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(year)) return null;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return null;
  }
  return candidate.toISOString().slice(0, 10);
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

  const sourcePublishedDateOnly =
    (isDateOnly(input.sourcePublishedAt) ? input.sourcePublishedAt : null) ??
    inferDateOnlyFromText(sourceText, currentPatch.publishedAt);
  const sourcePublishedAt = parseTime(input.sourcePublishedAt) ?? parseTime(sourcePublishedDateOnly);
  const patchPublishedAt = parseTime(currentPatch.publishedAt);
  if (
    sourcePublishedAt !== null &&
    patchPublishedAt !== null &&
    (sourcePublishedDateOnly
      ? dateOnlyIsBefore(sourcePublishedDateOnly, patchPublishedAt)
      : sourcePublishedAt < patchPublishedAt)
  ) {
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
    return { canStore: true, canPublish: true, reason: "fresh_language" };
  }

  return { canStore: true, canPublish: false, reason: "unknown_source_freshness" };
}
