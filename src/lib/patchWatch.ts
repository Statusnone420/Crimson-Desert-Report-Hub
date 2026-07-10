export type PatchContext = {
  version: string;
  publishedAt: string | null;
};

export type PatchWatchEvidenceInput = {
  title?: string | null;
  summary?: string | null;
  sourcePublishedAt?: string | null;
};

function patchVersionKey(value: string): string | null {
  const match = value.match(/\b(\d+)\.(\d{1,2})(?:\.(\d{1,2}))?\b/);
  if (!match) return null;
  const parts = [match[1], match[2], match[3]].filter((part): part is string => Boolean(part));
  return parts.map((part) => String(Number(part))).join(".");
}

function explicitPatchVersionMentions(text: string): { key: string; isFullVersion: boolean }[] {
  const mentions: { key: string; isFullVersion: boolean }[] = [];
  const patterns = [
    /\b(?:patch|update|hotfix|v)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(?:after|since|on)\s*(\d+\.\d{1,2}(?:\.\d{1,2})?)\b/gi,
    /\b(\d+\.\d{1,2}(?:\.\d{1,2})?)\s*(?:patch|update|hotfix)\b/gi,
  ] as const;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const version = match[1];
      const key = version ? patchVersionKey(version) : null;
      if (key && !mentions.some((mention) => mention.key === key)) {
        mentions.push({ key, isFullVersion: version.split(".").length === 3 });
      }
    }
  }
  return mentions;
}

export function patchFamilyKey(version: string): string | null {
  const key = patchVersionKey(version);
  if (!key) return null;
  const [major, minor] = key.split(".");
  return major && minor ? `${major}.${minor}` : null;
}

export function belongsToPatchFamily(version: string, currentVersion: string): boolean {
  const versionFamily = patchFamilyKey(version);
  const currentFamily = patchFamilyKey(currentVersion);
  return Boolean(versionFamily && currentFamily && versionFamily === currentFamily);
}

export function matchesPatchVersion(version: string | null | undefined, currentVersion: string): boolean {
  if (!version) return false;
  const versionKey = patchVersionKey(version);
  const currentVersionKey = patchVersionKey(currentVersion);
  return Boolean(versionKey && currentVersionKey && versionKey === currentVersionKey);
}

export function isPostCurrentPatchEvidence(input: PatchWatchEvidenceInput, currentPatch: PatchContext): boolean {
  const sourceText = `${input.title ?? ""} ${input.summary ?? ""}`;
  const currentVersionKey = patchVersionKey(currentPatch.version);
  const explicitMentions = explicitPatchVersionMentions(sourceText);
  if (currentVersionKey && explicitMentions.some((mention) => mention.key === currentVersionKey)) return true;
  if (currentVersionKey && explicitMentions.some((mention) => mention.isFullVersion)) return false;

  if (!input.sourcePublishedAt || !currentPatch.publishedAt) return false;
  const sourceTime = new Date(input.sourcePublishedAt).getTime();
  const patchTime = new Date(currentPatch.publishedAt).getTime();
  return Number.isFinite(sourceTime) && Number.isFinite(patchTime) && sourceTime >= patchTime;
}
