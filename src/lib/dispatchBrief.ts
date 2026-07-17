import type { DailySignalDay } from "@/lib/queries";

/**
 * Editorial Dispatch homepage composition: the lead headline, dek, and pulse
 * headline are selected from a fixed bank of neutral phrasings by trend state.
 * Everything is deterministic and count-backed — sentence-case, literal, no
 * clickbait, and a quiet board is presented as a real reading, never padded.
 */

export type BriefTrend = "quiet" | "easing" | "flat" | "rising";

export type ContestedClaim = {
  title: string;
  stillCount: number;
  fixedCount: number;
};

export type DispatchBriefInput = {
  patchVersion: string;
  publishedAt: string | null;
  reports: number;
  taps: number;
  keptLeadsThisWeek: number;
  /** Most contested verifying cluster (highest still-happening tally), if any. */
  contested: ContestedClaim | null;
  claimedFixCount: number;
  contestedClaimCount: number;
  series: DailySignalDay[] | null;
  now?: Date;
};

export type DispatchBrief = {
  kicker: string;
  headline: string;
  dek: string;
  pulseHeadline: string;
  trend: BriefTrend;
  dayNumber: number | null;
  /** Whole-percent weekly report delta vs the first week since publish; null when the launch week had no reports. */
  weeklyDeltaPct: number | null;
  launchWeekReports: number;
  latestWeekReports: number;
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

/** x.y.0 reads as an update; a nonzero third component reads as a hotfix. */
export function patchTypeLabel(version: string): "HOTFIX" | "UPDATE" {
  const third = version.trim().split(".")[2];
  return third && Number.parseInt(third, 10) > 0 ? "HOTFIX" : "UPDATE";
}

export function patchDayNumber(publishedAt: string | null, now: Date): number | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published) || published > now.getTime()) return null;
  return Math.floor((now.getTime() - published) / (24 * 60 * 60 * 1000)) + 1;
}

/** Weekly report volume: first 7 days since publish vs the most recent 7 days. */
export function weeklyReportWindows(series: DailySignalDay[] | null): { launch: number; latest: number } | null {
  if (!series || series.length === 0) return null;
  const launch = series.slice(0, 7).reduce((sum, day) => sum + day.reports, 0);
  const latest = series.slice(-7).reduce((sum, day) => sum + day.reports, 0);
  return { launch, latest };
}

export function composeDispatchBrief(input: DispatchBriefInput): DispatchBrief {
  const now = input.now ?? new Date();
  const dayNumber = patchDayNumber(input.publishedAt, now);
  const windows = weeklyReportWindows(input.series);
  const launchWeekReports = windows?.launch ?? 0;
  const latestWeekReports = windows?.latest ?? 0;
  const weeklyDeltaPct =
    windows && windows.launch > 0
      ? Math.round(((windows.latest - windows.launch) / windows.launch) * 100)
      : null;

  const quiet = input.reports === 0 && input.taps === 0;
  const trend: BriefTrend = quiet
    ? "quiet"
    : !windows || windows.launch === windows.latest
      ? "flat"
      : windows.latest < windows.launch
        ? "easing"
        : "rising";

  const kickerParts = [`PATCH ${input.patchVersion}`, patchTypeLabel(input.patchVersion)];
  if (dayNumber !== null) kickerParts.push(`DAY ${dayNumber}`);
  const kicker = kickerParts.join(" · ");

  const contested = input.contested && input.contested.stillCount > input.contested.fixedCount ? input.contested : null;

  const trendHeadline: Record<BriefTrend, string> = {
    quiet: `A quiet board on ${input.patchVersion}.`,
    easing: `Reports are easing since ${input.patchVersion} landed.`,
    flat: `Report volume is holding steady on ${input.patchVersion}.`,
    rising: `Reports are rising since ${input.patchVersion} landed.`,
  };
  const headline = contested
    ? `${trendHeadline[trend]} One claimed fix is still contested.`
    : trendHeadline[trend];

  const dayLead = dayNumber !== null ? `Day ${dayNumber} in, the` : "The";
  const claimSentence =
    input.claimedFixCount === 0
      ? `${input.patchVersion} claims no fixes; the board tracks what players file anyway.`
      : contested
        ? `Of ${plural(input.claimedFixCount, "claimed fix", "claimed fixes")}, players still contest "${contested.title}" — ${plural(contested.stillCount, "tap", "taps")} say still happening against ${contested.fixedCount} fixed.`
        : input.contestedClaimCount > 0
          ? `${plural(input.contestedClaimCount, "of its claimed fixes is", `of its ${input.claimedFixCount} claimed fixes are`)} still contested by players.`
          : `Its ${plural(input.claimedFixCount, "claimed fix", "claimed fixes")} ${input.claimedFixCount === 1 ? "is" : "are"} not contested by player taps so far.`;
  const dek = quiet
    ? `No player reports or taps have been filed against ${input.patchVersion} yet. Quiet is a real reading — the board never fills in blanks.`
    : `${dayLead} board holds ${plural(input.reports, "player report")} and ${plural(input.taps, "player tap")} against ${input.patchVersion}. ${claimSentence}`;

  const pulseHeadline: string =
    trend === "quiet"
      ? "No player signals filed yet this patch. A quiet board is a real reading."
      : trend === "easing"
        ? "Signal is easing — weekly report volume is below the launch week."
        : trend === "rising"
          ? "Signal is rising — weekly report volume is above the launch week."
          : "Signal is flat — weekly report volume is holding at the launch-week level.";

  return {
    kicker,
    headline,
    dek,
    pulseHeadline,
    trend,
    dayNumber,
    weeklyDeltaPct,
    launchWeekReports,
    latestWeekReports,
  };
}

export function formatWeeklyDelta(brief: Pick<DispatchBrief, "weeklyDeltaPct" | "latestWeekReports">): string {
  if (brief.weeklyDeltaPct === null) return String(brief.latestWeekReports);
  if (brief.weeklyDeltaPct > 0) return `+${brief.weeklyDeltaPct}%`;
  if (brief.weeklyDeltaPct < 0) return `−${Math.abs(brief.weeklyDeltaPct)}%`;
  return "0%";
}

export function weeklyDeltaSentence(brief: Pick<DispatchBrief, "weeklyDeltaPct" | "trend">): string {
  if (brief.weeklyDeltaPct === null) {
    return "Reports this week; the launch week had none to compare against.";
  }
  if (brief.weeklyDeltaPct < 0) return "Weekly report volume versus launch week. Easing, not resolved.";
  if (brief.weeklyDeltaPct > 0) return "Weekly report volume versus launch week. Rising, not settling.";
  return "Weekly report volume versus launch week. Holding level.";
}
