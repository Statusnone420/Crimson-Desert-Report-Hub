import { displayCandidateCount } from "@/lib/observatoryMetrics";

export type RunMessageGroup = {
  code: string;
  count: number;
  label: string;
  detail: string;
  summaryLabel: string;
};

type MessageMeta = {
  label: string;
  detail: string;
  summaryLabel: string;
};

const EASTERN_TIME_ZONE = "America/New_York";

const SKIP_META: Record<string, MessageMeta> = {
  budget_capped: {
    label: "Budget capped",
    detail: "The monthly automation budget was reached, so paid extraction stopped while free maintenance continues.",
    summaryLabel: "budget capped",
  },
  budget_read_failed: {
    label: "Budget read failed",
    detail: "The scanner could not read the spend ledger, so it failed closed.",
    summaryLabel: "budget read failed",
  },
  budget_zero: {
    label: "Budget is zero",
    detail: "Paid extraction is disabled by the monthly budget setting.",
    summaryLabel: "budget zero",
  },
  all_candidates_prefiltered: {
    label: "No LLM candidates",
    detail: "All candidates failed the cheap relevance screen before OpenRouter, so no LLM call was made.",
    summaryLabel: "no LLM candidates",
  },
  candidate_recon: {
    label: "Read the full page",
    detail: "A promising trusted source had too little text to judge, so the scanner read the page itself before deciding.",
    summaryLabel: "read the full page",
  },
  candidate_recon_unavailable: {
    label: "Full page unavailable",
    detail:
      "The scanner tried to read the full page and the source returned nothing, so it judged the short summary instead. No search credit was spent. Reddit refuses our reader, so its threads always land here.",
    summaryLabel: "full page unavailable",
  },
  candidate_rescued: {
    label: "Candidate rescued",
    detail: "A thin current-patch source was kept private for corroboration instead of being discarded or published.",
    summaryLabel: "candidate rescued",
  },
  off_topic: {
    label: "Off-topic",
    detail: "The page never mentions Crimson Desert, so it was dropped before any other screening.",
    summaryLabel: "off-topic",
  },
  reject_dedupe_read_failed: {
    label: "Reject dedupe read failed",
    detail: "The scanner could not check the rejected pile for duplicates; rejected candidates were stored as usual.",
    summaryLabel: "reject dedupe read failed",
  },
  rescue_memory_read_failed: {
    label: "Rescue memory read failed",
    detail: "The scanner could not check whether rejected candidates were previously rescued leads; they went to the rejected pile as usual.",
    summaryLabel: "rescue memory read failed",
  },
  rescued_signal_reobserved: {
    label: "Rescued lead seen again",
    detail: "A previously rescued lead reappeared in search; its freshness was updated instead of re-rejecting it.",
    summaryLabel: "rescued lead seen again",
  },
  llm_budget_capped: {
    label: "LLM cap reached",
    detail: "The scanner reached its monthly LLM cap; deterministic scanning and patch maintenance continue.",
    summaryLabel: "LLM cap reached",
  },
  category_other: {
    label: "Other category",
    detail: "Extraction classified the item as other, so it was not kept as an issue signal.",
    summaryLabel: "other category",
  },
  llm_allowance_exhausted: {
    label: "LLM allowance exhausted",
    detail: "The run used its LLM call allowance; remaining items fell back to deterministic extraction.",
    summaryLabel: "LLM allowance exhausted",
  },
  openrouter_invalid_json: {
    label: "OpenRouter invalid JSON",
    detail: "OpenRouter returned unusable JSON; deterministic extraction was used as a fallback.",
    summaryLabel: "OpenRouter invalid JSON",
  },
  openrouter_missing_config: {
    label: "OpenRouter not configured",
    detail: "OpenRouter keys or model settings are missing, so deterministic extraction was used.",
    summaryLabel: "OpenRouter not configured",
  },
  openrouter_missing: {
    label: "OpenRouter not configured",
    detail: "OpenRouter keys or model settings are missing, so deterministic extraction was used.",
    summaryLabel: "OpenRouter not configured",
  },
  openrouter_paid_model: {
    label: "OpenRouter model blocked",
    detail: "The configured automation model is not on the approved list, so deterministic extraction was used.",
    summaryLabel: "OpenRouter model blocked",
  },
  openrouter_circuit_open: {
    label: "OpenRouter safety circuit open",
    detail:
      "OpenRouter is paused for safety: an out-of-bounds cost keeps it off for the month, and repeated unverifiable costs keep it off until those failures age out of the last 24 hours.",
    summaryLabel: "OpenRouter safety circuit open",
  },
  openrouter_no_route: {
    label: "No provider matched the limits",
    detail:
      "No OpenRouter provider met the scanner's price ceiling, zero-retention rule, and required parameters at once, so nothing was called and deterministic extraction was used. Nothing was spent and the safety circuit is unaffected.",
    summaryLabel: "no provider matched the limits",
  },
  openrouter_cost_unverified: {
    label: "OpenRouter cost unverified",
    detail:
      "OpenRouter did not return trustworthy cost metadata; the request's worst-case cost was charged against the monthly budget. Repeated failures within 24 hours open the safety circuit.",
    summaryLabel: "OpenRouter cost unverified",
  },
  openrouter_budget_exceeded: {
    label: "OpenRouter request ceiling exceeded",
    detail: "A response exceeded its reserved request ceiling, so the exact cost was recorded and the monthly circuit opened.",
    summaryLabel: "OpenRouter request ceiling exceeded",
  },
  openrouter_provider_failure: {
    label: "OpenRouter provider failure",
    detail: "OpenRouter failed or returned an error; deterministic extraction was used as a fallback.",
    summaryLabel: "OpenRouter provider failure",
  },
  openrouter_unexpected_charge: {
    label: "Legacy OpenRouter cost anomaly",
    detail: "A prior free-only release recorded an unexpected charge marker, so the monthly safety circuit remains open.",
    summaryLabel: "legacy OpenRouter cost anomaly",
  },
  paused: {
    label: "Scheduled scans paused",
    detail: "The cron fired, but scheduled scans are paused, so no scan started.",
    summaryLabel: "paused",
  },
  recent_run: {
    label: "Recent scan already ran",
    detail: "The cron fired, but a real scan started inside the scanner policy window, so this attempt stood down. Dry runs never block it.",
    summaryLabel: "recent scan already ran",
  },
  reddit_disabled: {
    label: "Reddit disabled",
    detail: "The Reddit API is permanently disabled, so this run used web search only.",
    summaryLabel: "Reddit disabled",
  },
  scan_already_running: {
    label: "Scan already running",
    detail: "Another scan was still in progress, so this one did not start.",
    summaryLabel: "scan already running",
  },
  search_disabled: {
    label: "Search unavailable",
    detail: "Tavily credentials are not configured, so web discovery was skipped while patch maintenance continues.",
    summaryLabel: "search disabled",
  },
  tavily_credit_cap: {
    label: "Search credit cap reached",
    detail: "The scanner reached its monthly Tavily credit cap; web discovery stopped while patch maintenance continues.",
    summaryLabel: "search credit cap reached",
  },
  source_not_issue_report: {
    label: "Not issue reports",
    detail: "The source looked like patch notes, reviews, guides, or general content instead of a player issue report.",
    summaryLabel: "not issue reports",
  },
  stale_running_run: {
    label: "Crashed run cleaned up",
    detail: "A previous run never finished (likely a serverless timeout) and was marked failed by the sweeper.",
    summaryLabel: "crashed run cleaned up",
  },
  wrong_patch: {
    label: "Wrong patch",
    detail: "The source mentioned a different patch version than the current tracked patch.",
    summaryLabel: "wrong patch",
  },
};

function normalizeSpaces(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function metaFor(code: string): MessageMeta {
  return (
    SKIP_META[code] ?? {
      label: code.replace(/_/g, " "),
      detail: "Unrecognized scanner code. Check the raw code before acting on it.",
      summaryLabel: code.replace(/_/g, " "),
    }
  );
}

function groupMessages(messages: string[]): RunMessageGroup[] {
  const firstSeen = new Map<string, number>();
  const counts = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!firstSeen.has(message)) firstSeen.set(message, index);
    counts.set(message, (counts.get(message) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([code, count]) => ({ code, count, ...metaFor(code), firstSeen: firstSeen.get(code) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen)
    .map((group) => ({
      code: group.code,
      count: group.count,
      label: group.label,
      detail: group.detail,
      summaryLabel: group.summaryLabel,
    }));
}

export function formatEasternDateTime(iso: string | null): string {
  if (!iso) return "not finished";
  return normalizeSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: EASTERN_TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso)),
  );
}

export function summarizeRunMessages(skips: string[], errors: string[]) {
  const skipGroups = groupMessages(skips);
  return {
    skipGroups,
    operatorSummary:
      skipGroups.length > 0
        ? skipGroups.map((group) => `${group.count} ${group.summaryLabel}`).join("; ")
        : "No skips",
    errorSummary: errors.length > 0 ? errors.map((error) => SKIP_META[error]?.label ?? error).join("; ") : "No errors",
  };
}

const DROP_SKIP_PLAIN: Record<string, string> = {
  wrong_patch: "about a different patch",
  source_not_issue_report: "not a bug report",
  category_other: "not sortable into a bug area",
  off_topic: "not about Crimson Desert",
  duplicate: "a duplicate of something we already have",
  reddit_disabled: "Reddit source is off",
  openrouter_invalid_json: "an AI read failed (used a fallback)",
  openrouter_provider_failure: "an AI provider failed (used a fallback)",
};

/** Player-facing phrasing for a scanner code — plain language, no jargon. */
export function plainSkipPhrase(code: string): string {
  return DROP_SKIP_PLAIN[code] ?? SKIP_META[code]?.summaryLabel ?? code.replace(/_/g, " ");
}

type PlainScanRun = {
  search_results_seen: number;
  reddit_posts_seen: number;
  signals_inserted: number;
  signals_reobserved: number;
  clusters_promoted: number;
  skips: string[];
  funnel?: Record<string, number> | null;
};

export type PlainScan = {
  found: number;
  kept: number;
  reConfirmed: number;
  held: number;
  published: number;
  dropped: number;
  droppedBreakdown: { label: string; count: number }[];
};

const DROP_CODES = ["wrong_patch", "source_not_issue_report", "category_other", "off_topic"] as const;

/** Turn a run row into plain-language counts for the "last scan, in plain English" panel. */
export function describeScanPlain(run: PlainScanRun): PlainScan {
  // New funnels include all screened lanes (including Steam); historical runs
  // fall back to web results + Reddit posts.
  const found = displayCandidateCount(run);
  const kept = run.signals_inserted ?? 0;
  // Dropped = everything reviewed that wasn't kept (dedup + prefilter + LLM reject),
  // so it matches the kept/dropped bar. The prefilter reasons are only the breakdown.
  const dropped = Math.max(0, found - kept);
  const droppedBreakdown = DROP_CODES.map((code) => ({
    label: plainSkipPhrase(code),
    count: run.skips.filter((skip) => skip === code).length,
  })).filter((entry) => entry.count > 0);
  const reConfirmed = run.signals_reobserved ?? 0;
  const published = run.clusters_promoted ?? 0;
  // "Held" = kept signals still pending a second source: total kept minus the ones
  // that merely re-confirmed a known issue and the ones promoted public this run.
  // (candidates_rescued is only the recon-lane subset, so it undercounts held.)
  const held = Math.max(0, kept - reConfirmed - published);
  return { found, kept, reConfirmed, held, published, dropped, droppedBreakdown };
}
