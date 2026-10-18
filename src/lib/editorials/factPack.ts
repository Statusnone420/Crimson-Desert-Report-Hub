import type { ActivityDay, ActivityHistory } from "@/lib/activityHistory";
import { completeDays, reviewShare, typicalPlayers } from "@/lib/activityHistory";
import { formatUtcTimestamp, isPublicSourceUrl } from "@/lib/editorials/content";
import type { PatchEdition } from "@/lib/patchPublications";
import { patchPath } from "@/lib/patchPublications";

/**
 * The column's only input: public, aggregate, reviewed data. Official patch notes and
 * listed fixes, public issue aggregates, Steam and Twitch aggregates and check-in
 * counts. Never raw reports, rejected candidates, private source text, individual
 * check-ins, usernames or links to individual posts.
 */
export type EvidenceLabel = "Confirmed" | "Reported" | "One report";
export type StatusLabel = "Fixed (per patch notes)" | "Still happening";

export type Fact = {
  id: string;
  text: string;
  period: string;
  value: number | string | null;
  label?: EvidenceLabel;
  status?: StatusLabel;
  source: { label: string; url: string };
};

export type FactPackMetrics = {
  patchVersions: string[];
  latestPatch: { version: string; kind: "update" | "hotfix"; publishedAt: string | null } | null;
  playersAvg7d: number | null;
  reviewShare7d: number | null;
  twitchAvg7d: number | null;
  /** Issues that count as a pattern: Reported or Confirmed on the public issue page. */
  patternIssueIds: string[];
};

export type FactPackDeltas = {
  newPatchVersions: string[];
  newUpdate: boolean;
  playersChangePct: number | null;
  reviewShareChangePoints: number | null;
  twitchChangePct: number | null;
  newPatternIssueIds: string[];
};

export type FactPack = {
  version: 1;
  builtAt: string;
  facts: Fact[];
  metrics: FactPackMetrics;
  deltas: FactPackDeltas;
  /** Private notes on data that could not be read. Never shown publicly. */
  gaps: string[];
};

/** The public issue aggregates the fact pack may use, read from the issue board. */
export type IssueAggregate = {
  id: string;
  title: string;
  approvedReports: number;
  checkins: number;
  checkinNetworks: number;
  publicPosts: number;
  postsBySite: Record<string, number>;
  officialFixListed: boolean;
  stillHappening: boolean;
  strength: number;
};

export type IssueBoard = { available: true; patchVersion: string; issues: IssueAggregate[] } | { available: false };

export type FactPackInput = {
  now: Date;
  patches: { available: true; editions: PatchEdition[] } | { available: false };
  history: ActivityHistory;
  board: IssueBoard;
  previous: FactPackMetrics | null;
};

const DAY_MS = 86_400_000;
const MAX_FIXES = 8;
const MAX_ISSUES = 8;
const MAX_NEW_PATCHES = 3;
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function patchKind(version: string): "update" | "hotfix" {
  return Number(version.split(".")[2] ?? 0) > 0 ? "hotfix" : "update";
}

/**
 * Evidence labels never go past what the public issue page shows. Confirmed: Pearl
 * Abyss lists a fix. Reported: two or more approved reports, or check-ins from two or
 * more networks (the Hub's two-network rule). One report: a single one of either.
 * Forum links alone earn no label: links are not people, and the scanner reads no authors.
 */
export function evidenceLabel(issue: IssueAggregate): EvidenceLabel | null {
  if (issue.officialFixListed) return "Confirmed";
  if (issue.approvedReports >= 2 || issue.checkinNetworks >= 2) return "Reported";
  if (issue.approvedReports === 1 || issue.checkinNetworks === 1) return "One report";
  return null;
}

export function statusLabel(issue: IssueAggregate): StatusLabel | null {
  if (issue.stillHappening) return "Still happening";
  if (issue.officialFixListed) return "Fixed (per patch notes)";
  return null;
}

function percentChange(current: number | null, before: number | null): number | null {
  return current !== null && before !== null && before > 0 ? ((current - before) / before) * 100 : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function dayRange(days: ActivityDay[]): string {
  if (!days.length) return "";
  const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${label(days[0].day)} to ${label(days[days.length - 1].day)} (UTC)`;
}

function windows(history: ActivityHistory) {
  const complete = completeDays(history);
  return { recent: complete.slice(-7), before: complete.slice(-14, -7) };
}

function playersAverage(days: ActivityDay[]): number | null {
  const values = days.flatMap((day) => (day.playersAvg === null ? [] : [day.playersAvg]));
  return values.length >= 5 ? average(values) : null;
}

function twitchAverage(days: ActivityDay[]): number | null {
  const values = days.flatMap((day) => (day.twitchAvg === null ? [] : [day.twitchAvg]));
  return values.length >= 5 ? average(values) : null;
}

function signed(value: number, unit: string): string {
  return `${value >= 0 ? "up" : "down"} ${NUMBER.format(Math.abs(value))}${unit}`;
}

/** Builds the fact pack and its deltas against the previous edition's pack (or the week before). */
export function buildFactPack(input: FactPackInput): FactPack {
  const facts: Fact[] = [];
  const gaps: string[] = [];
  const counters: Record<string, number> = {};
  const add = (prefix: string, fact: Omit<Fact, "id">) => {
    if (!isPublicSourceUrl(fact.source.url)) return;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const label = fact.source.label.length > 150 ? `${fact.source.label.slice(0, 149).trimEnd()}…` : fact.source.label;
    facts.push({ id: `${prefix}${counters[prefix]}`, ...fact, source: { ...fact.source, label } });
  };

  // Patches and listed fixes.
  let patchVersions: string[] = [];
  let latestPatch: FactPackMetrics["latestPatch"] = null;
  let newPatchVersions: string[] = [];
  if (input.patches.available) {
    const editions = input.patches.editions;
    patchVersions = editions.map((edition) => edition.version);
    const latest = editions[0];
    if (latest) latestPatch = { version: latest.version, kind: patchKind(latest.version), publishedAt: latest.publishedAt };
    newPatchVersions = input.previous
      ? patchVersions.filter((version) => !input.previous!.patchVersions.includes(version))
      : editions.filter((edition) => Date.parse(edition.publishedAt ?? edition.observedAt) >= input.now.getTime() - 7 * DAY_MS).map((edition) => edition.version);
    const described = [latest, ...editions.filter((edition) => edition !== latest && newPatchVersions.includes(edition.version)).slice(0, MAX_NEW_PATCHES - 1)].filter(Boolean) as PatchEdition[];
    for (const edition of described) {
      const when = edition.publishedAt ? `published ${formatUtcTimestamp(edition.publishedAt)}` : `first recorded by the Hub ${formatUtcTimestamp(edition.observedAt)}`;
      const fixCount = edition.totalClaimedFixes ?? edition.fixes.length;
      add("P", {
        text: `Patch ${edition.version} (${patchKind(edition.version)}) official notes ${when}. The notes list ${NUMBER.format(fixCount)} ${fixCount === 1 ? "fix" : "fixes"}.`,
        period: edition.publishedAt ? formatUtcTimestamp(edition.publishedAt) : formatUtcTimestamp(edition.observedAt),
        value: edition.version,
        source: { label: `Pearl Abyss patch notes ${edition.version}`, url: edition.officialUrl },
      });
    }
    for (const fix of latest?.fixes.slice(0, MAX_FIXES) ?? []) {
      add("F", {
        text: `Patch ${latest.version} lists this fix: "${fix.fixText}"`,
        period: latest.publishedAt ? formatUtcTimestamp(latest.publishedAt) : formatUtcTimestamp(latest.observedAt),
        value: latest.version,
        label: "Confirmed",
        source: { label: `Patch ${latest.version} fix record, Report Hub`, url: patchPath(latest.version) },
      });
    }
  } else gaps.push("patches_unavailable");

  // Steam players, reviews and Twitch: recorded context, never player evidence.
  const { recent, before } = windows(input.history);
  const playersAvg7d = input.history.lanes.players === "ready" ? playersAverage(recent) : null;
  const reviewShare7d = input.history.lanes.reviews === "ready" ? reviewShare(recent, 3)?.share ?? null : null;
  const twitchAvg7d = input.history.lanes.twitch === "ready" ? twitchAverage(recent) : null;
  const playersBaseline = input.previous ? input.previous.playersAvg7d : playersAverage(before);
  const reviewBaseline = input.previous ? input.previous.reviewShare7d : (input.history.lanes.reviews === "ready" ? reviewShare(before, 3)?.share ?? null : null);
  const twitchBaseline = input.previous ? input.previous.twitchAvg7d : twitchAverage(before);
  const since = input.previous ? "since the last edition" : "on the 7 days before";

  if (input.history.lanes.players === "ready") {
    const latest = input.history.playerCaptures.at(-1);
    const typical = typicalPlayers(input.history.playerCaptures);
    if (latest) {
      const difference = typical && typical.median > 0 ? (latest.playerCount / typical.median - 1) * 100 : null;
      add("S", {
        text: `${NUMBER.format(latest.playerCount)} players were online on Steam at ${formatUtcTimestamp(latest.capturedAt)}${difference !== null && typical
          ? `, ${NUMBER.format(Math.abs(difference))}% ${difference < 0 ? "below" : "above"} the usual for a ${typical.weekday} at that time (median of ${typical.samples} earlier weeks: ${NUMBER.format(typical.median)})`
          : ""}.`,
        period: formatUtcTimestamp(latest.capturedAt),
        value: latest.playerCount,
        source: { label: "Steam players online, Report Hub Observatory", url: "/observatory#updates" },
      });
    }
    if (playersAvg7d !== null) {
      const change = percentChange(playersAvg7d, playersBaseline);
      add("S", {
        text: `Steam players online averaged ${NUMBER.format(playersAvg7d)} over ${dayRange(recent)}${change !== null ? `, ${signed(change, "%")} ${since}` : ""}.`,
        period: dayRange(recent),
        value: Math.round(playersAvg7d),
        source: { label: "Steam players online, Report Hub Observatory", url: "/observatory#updates" },
      });
    }
  } else gaps.push("players_unavailable");

  if (input.history.lanes.reviews === "ready") {
    const share = reviewShare(recent, 3);
    if (share) {
      const change = reviewBaseline !== null ? share.share - reviewBaseline : null;
      add("S", {
        text: `${NUMBER.format(share.share)}% of ${NUMBER.format(share.total)} new Steam reviews were positive over ${dayRange(recent)}${change !== null ? `, ${signed(change, " points")} ${since}` : ""}.`,
        period: dayRange(recent),
        value: Math.round(share.share),
        source: { label: "Daily Steam reviews, Report Hub Observatory", url: "/observatory#daily-reviews" },
      });
    }
    const lifetime = input.history.days.findLast((day) => day.lifetimePositive !== null)?.lifetimePositive ?? null;
    if (lifetime !== null) {
      add("S", {
        text: `Crimson Desert's all-time Steam review score was ${NUMBER.format(lifetime)}% positive.`,
        period: dayRange(recent.slice(-1)),
        value: Math.round(lifetime),
        source: { label: "Steam review record, Report Hub Observatory", url: "/observatory#review-record" },
      });
    }
  } else gaps.push("reviews_unavailable");

  if (input.history.lanes.twitch === "ready" && twitchAvg7d !== null) {
    const change = percentChange(twitchAvg7d, twitchBaseline);
    const peak = Math.max(...recent.flatMap((day) => (day.twitchPeak === null ? [] : [day.twitchPeak])));
    add("T", {
      text: `Twitch viewers averaged ${NUMBER.format(twitchAvg7d)} over ${dayRange(recent)}${Number.isFinite(peak) ? `, peaking at ${NUMBER.format(peak)}` : ""}${change !== null ? `, ${signed(change, "%")} ${since}` : ""}.`,
      period: dayRange(recent),
      value: Math.round(twitchAvg7d),
      source: { label: "Twitch audience, Report Hub Observatory", url: "/observatory#platform-activity" },
    });
  } else if (input.history.lanes.twitch !== "ready") gaps.push("twitch_unavailable");

  // Known issues: public aggregates and the labels the issue page supports.
  let patternIssueIds: string[] = [];
  let newPatternIssueIds: string[] = [];
  if (input.board.available) {
    const board = input.board;
    const previousPatterns = input.previous?.patternIssueIds ?? [];
    const isPattern = (issue: IssueAggregate) => evidenceLabel(issue) === "Reported" || evidenceLabel(issue) === "Confirmed";
    const isNewPattern = (issue: IssueAggregate) => isPattern(issue) && !previousPatterns.includes(issue.id);
    // Newly Reported or Confirmed issues come first, so any news that raises the score is in the pack.
    const issues = [...board.issues].sort((a, b) => Number(isNewPattern(b)) - Number(isNewPattern(a)) || b.strength - a.strength).slice(0, MAX_ISSUES);
    patternIssueIds = board.issues.filter(isPattern).map((issue) => issue.id);
    newPatternIssueIds = issues.filter(isNewPattern).map((issue) => issue.id);
    for (const issue of issues) {
      const label = evidenceLabel(issue);
      const status = statusLabel(issue);
      const parts = [
        label ? `Evidence: ${label}.` : "Evidence: forum links only, no label.",
        status ? `Status: ${status}.` : null,
        issue.approvedReports ? `${issue.approvedReports} approved player ${issue.approvedReports === 1 ? "report" : "reports"} on patch ${board.patchVersion}.` : null,
        issue.checkins ? `${issue.checkins} "happening to me" ${issue.checkins === 1 ? "check-in" : "check-ins"} on patch ${board.patchVersion}.` : null,
        issue.publicPosts ? `Mentioned in ${issue.publicPosts} public ${issue.publicPosts === 1 ? "post" : "posts"} (${Object.entries(issue.postsBySite).map(([site, count]) => `${site} ${count}`).join(", ")}).` : null,
      ].filter(Boolean);
      add("C", {
        text: `Known issue "${issue.title}". ${parts.join(" ")}`,
        period: `Patch ${board.patchVersion}`,
        value: issue.approvedReports + issue.checkins,
        ...(label ? { label } : {}),
        ...(status ? { status } : {}),
        source: { label: `"${issue.title}" on the issue board, Report Hub`, url: `/issues#issue-${issue.id}` },
      });
    }
    const checkins = board.issues.reduce((sum, issue) => sum + issue.checkins, 0);
    const withCheckins = board.issues.filter((issue) => issue.checkins > 0).length;
    add("K", {
      text: `Players added ${NUMBER.format(checkins)} "happening to me" ${checkins === 1 ? "check-in" : "check-ins"} across ${withCheckins} known ${withCheckins === 1 ? "issue" : "issues"} on patch ${board.patchVersion}.`,
      period: `Patch ${board.patchVersion}`,
      value: checkins,
      source: { label: "Issue board, Report Hub", url: "/issues" },
    });
  } else gaps.push("issues_unavailable");

  return {
    version: 1,
    builtAt: input.now.toISOString(),
    facts,
    gaps,
    metrics: { patchVersions, latestPatch, playersAvg7d, reviewShare7d, twitchAvg7d, patternIssueIds },
    deltas: {
      newPatchVersions,
      newUpdate: newPatchVersions.some((version) => patchKind(version) === "update"),
      playersChangePct: percentChange(playersAvg7d, playersBaseline),
      reviewShareChangePoints: reviewShare7d !== null && reviewBaseline !== null ? reviewShare7d - reviewBaseline : null,
      twitchChangePct: percentChange(twitchAvg7d, twitchBaseline),
      newPatternIssueIds,
    },
  };
}
