export type PlatformContextStatus = "ok" | "absent" | "unconfigured" | "malformed" | "stale" | "error";

type PlatformContextStatusInput = PlatformContextStatus | string | null | undefined;

export type ReviewDeltaTone = "positive" | "negative" | "flat";

function normalizePlatformContextStatus(status: PlatformContextStatusInput): PlatformContextStatus {
  if (
    status === "ok" ||
    status === "absent" ||
    status === "unconfigured" ||
    status === "malformed" ||
    status === "stale" ||
    status === "error"
  ) {
    return status;
  }
  return "error";
}

export function isProviderStatusOk(status: PlatformContextStatusInput): boolean {
  return normalizePlatformContextStatus(status) === "ok";
}

export function formatSignedReviewDelta(delta: number | null): string {
  if (delta === null) return "—";
  const safe = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (safe === 0) return "0";
  return `${safe > 0 ? "+" : "-"}${Math.abs(safe)}`;
}

export function reviewDeltaTone(delta: number | null): ReviewDeltaTone {
  if (delta === null) return "flat";
  const safe = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (safe > 0) return "positive";
  if (safe < 0) return "negative";
  return "flat";
}

export function twitchCoverageLabel(complete: boolean | null): string {
  if (complete === true) return "Complete point-in-time count";
  if (complete === false) return "Point-in-time partial count";
  return "No Twitch count available";
}

export const PLATFORM_CONTEXT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function platformContextIsStale(capturedAt: string, now = new Date()): boolean {
  const capturedTime = new Date(capturedAt).getTime();
  return !Number.isFinite(capturedTime) || now.getTime() - capturedTime > PLATFORM_CONTEXT_MAX_AGE_MS;
}

export function platformUnavailableMessage(
  provider: string,
  status: PlatformContextStatusInput,
): string {
  const normalized = normalizePlatformContextStatus(status);
  if (normalized === "ok") return "";
  if (normalized === "absent") return `${provider} has no snapshot match for this check.`;
  if (normalized === "unconfigured") return `${provider} credentials are not configured.`;
  if (normalized === "malformed") return `${provider} returned malformed snapshot data.`;
  if (normalized === "stale") return `${provider} live counts are stale and have been hidden.`;
  return `${provider} request failed.`;
}
