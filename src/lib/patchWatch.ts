export type PatchContext = {
  version: string;
  publishedAt: string | null;
};

export type PatchWatchEvidenceInput = {
  title?: string | null;
  summary?: string | null;
  sourcePublishedAt?: string | null;
};

export type PlayerIssueStatusInput = {
  directReportCount: number;
  publicSignalCount: number;
  candidateSignalCount: number;
  postCurrentPatchEvidenceCount: number;
  fixStatus: string;
};

export type PlayerIssueStatus = {
  label: "No reports yet" | "Needs confirmation" | "Player reported" | "Watching fix" | "No fresh reports" | "Still happening";
  strengthLabel: string;
  detail: string;
  tone: "green" | "amber" | "crimson" | "blue" | "dim";
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

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

export function playerIssueStatus(input: PlayerIssueStatusInput): PlayerIssueStatus {
  const strengthLabel =
    input.directReportCount > 0 || input.publicSignalCount > 0
      ? `${plural(input.directReportCount, "player report")}, ${plural(input.publicSignalCount, "public source")}`
      : input.candidateSignalCount > 0
        ? `${plural(input.candidateSignalCount, "private mention")}, no public proof`
        : "No player reports or public sources yet";

  if (
    input.postCurrentPatchEvidenceCount > 0 &&
    (input.fixStatus === "fix_claimed" || input.fixStatus === "verified_fixed" || input.fixStatus === "persists")
  ) {
    return {
      label: "Still happening",
      strengthLabel,
      detail: "Fresh public evidence appeared after the claimed fix.",
      tone: "crimson",
    };
  }

  if (input.fixStatus === "verified_fixed") {
    return {
      label: "No fresh reports",
      strengthLabel,
      detail: "No fresh public reports are attached right now.",
      tone: "green",
    };
  }

  if (input.fixStatus === "fix_claimed") {
    return {
      label: "Watching fix",
      strengthLabel,
      detail: "PA claim matched this issue; watching for fresh reports.",
      tone: "amber",
    };
  }

  if (input.fixStatus === "persists") {
    return {
      label: "Still happening",
      strengthLabel,
      detail: "This is still marked active after a claimed fix.",
      tone: "crimson",
    };
  }

  if (input.directReportCount > 0) {
    return {
      label: "Player reported",
      strengthLabel,
      detail: "At least one approved player report exists. More reports or public sources would strengthen it.",
      tone: "blue",
    };
  }

  if (input.publicSignalCount > 0) {
    return {
      label: "Needs confirmation",
      strengthLabel,
      detail: "A public source mentions this, but no approved player report backs it yet.",
      tone: "amber",
    };
  }

  if (input.candidateSignalCount > 0) {
    return {
      label: "Needs confirmation",
      strengthLabel,
      detail: "The scanner found private candidates, but they need a player report or publishable source.",
      tone: "amber",
    };
  }

  return {
    label: "No reports yet",
    strengthLabel,
    detail: "No approved player reports or current public sources are attached yet.",
    tone: "green",
  };
}

export function publicPatchWatchItem(
  input: { title: string; description: string } & PlayerIssueStatusInput,
): { title: string; description: string } & PlayerIssueStatus {
  return {
    title: input.title,
    description: input.description,
    ...playerIssueStatus(input),
  };
}
