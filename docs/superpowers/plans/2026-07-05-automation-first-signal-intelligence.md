# Automation-First Signal Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Crimson Desert Report Hub from a manual-report-first dashboard into an automation-first signal intelligence system that watches Reddit and web search every 6 hours, promotes only confidence-threshold issues publicly, and uses one monthly budget knob to prevent surprise costs.

**Architecture:** Add a server-only automation layer with pure tested budget, extraction, dedupe, and promotion modules. Persist automation runs and richer source signals in Supabase, then update dashboard/issues/admin/dossier queries to show separate community signals, direct reports, and verified reports. All external providers are abstracted and tested with fixtures; CI never calls Reddit, search APIs, or OpenRouter.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres service-role server access, Vitest, Playwright, Reddit OAuth, Tavily-style search provider abstraction, OpenRouter `:free` model extraction.

---

## File Map

- Create `supabase/migrations/0003_automation_signals.sql`: automation schema expansion and indexes.
- Modify `.env.local.example`: add `AUTOMATION_BUDGET_USD_MONTHLY`, `TAVILY_API_KEY`, `AUTOMATION_SUBREDDITS`, `OPENROUTER_FREE_MODEL`.
- Modify `src/lib/env.ts`: budget/search feature/env helpers.
- Create `src/lib/automation/budget.ts`: one-knob monthly budget resolver.
- Create `src/lib/automation/search.ts`: query pack, Tavily provider, provider interfaces.
- Create `src/lib/automation/extract.ts`: deterministic extraction, OpenRouter `:free` extraction parser/guard.
- Create `src/lib/automation/dedupe.ts`: URL/title/semantic fingerprint helpers.
- Create `src/lib/automation/promote.ts`: confidence threshold and weighted cluster scoring.
- Create `src/lib/automation/run.ts`: server-only orchestration for scheduled/dry/capped runs.
- Modify `src/app/api/cron/keepalive/route.ts`: keep existing purge/touch, add 6-hour automation run gate.
- Modify `src/app/admin/actions.ts`: replace manual Reddit-only action with dry/capped automation actions and visibility overrides.
- Modify `src/app/admin/source-monitor/page.tsx`: budget/run observability page.
- Modify `src/lib/queries.ts`: include public source signals and direct/verified counts.
- Modify `src/app/page.tsx`: dashboard labels and top issue source strength.
- Modify `src/app/issues/page.tsx`: separate community signals from verified excerpts.
- Modify `src/lib/dossier.ts` and `src/app/admin/actions.ts`: include signal/direct/verified sections.
- Modify `tests/e2e/mock-dev-server.mjs` and `tests/e2e/public-visual.spec.ts`: mock automation data and visual assertions.
- Add unit tests under `tests/automation*.test.ts`.
- Modify `README.md`: automation setup, budget knob, provider keys, test commands.

## Critical Corrections From Plan Review

The first draft guarded OpenRouter free model IDs and defined promotion rules, but the runner snippet did not yet use both pieces. During execution, these corrections are binding if they conflict with a later snippet:

- `src/lib/automation/extract.ts` must expose an OpenRouter-backed extraction path that only runs when `OPENROUTER_API_KEY` is present, `OPENROUTER_FREE_MODEL` ends in `:free`, and the current run still has LLM call allowance. It must fall back to deterministic extraction on missing config, bad model ID, bad JSON, or provider failure.
- `src/lib/automation/run.ts` must call that extraction path, increment `llmCallsUsed` only when the OpenRouter path actually runs, and persist `extraction_provider` plus `extraction_model` per signal.
- `src/lib/automation/run.ts` must not leave automation as "just collected private rows." After dedupe it must cluster new signals, update `source_signals.cluster_id`, evaluate `shouldPromoteSignalCluster`, update public/private/hidden status, and maintain `issue_clusters.signal_count`, `direct_report_count`, `verified_report_count`, `public_signal_count`, `last_signal_at`, and `auto_public`.
- Dry scans must still insert an `automation_runs` ledger row with `mode = 'dry_run'`, counts, skips, and errors, but must not insert or mutate `source_signals` or `issue_clusters`.
- The public dashboard and dossier must read only `source_signals.public_status = 'public'` for automated community signals, while direct reports remain driven by approved reports.
- Unit tests must cover these corrections: free-model guard, no paid calls at budget `0`, dry-run ledger without signal writes, public promotion after two independent sources, direct-report promotion, and private suppression for one weak source.

---

## Task 1: Schema, Env, And Budget Core

**Files:**
- Create: `supabase/migrations/0003_automation_signals.sql`
- Modify: `.env.local.example`
- Modify: `src/lib/env.ts`
- Create: `src/lib/automation/budget.ts`
- Test: `tests/automationBudget.test.ts`

- [ ] **Step 1: Write failing budget tests**

Create `tests/automationBudget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeAutomationBudget, countRemainingRunsThisMonth, rejectPaidOpenRouterModel } from "@/lib/automation/budget";

describe("automation budget", () => {
  it("budget 0 disables paid search and llm calls", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 0,
      spentMonthToDateUsd: 0,
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(false);
    expect(budget.maxSearchQueries).toBe(0);
    expect(budget.maxLlmCalls).toBe(0);
    expect(budget.skipReasons).toContain("budget_zero");
  });

  it("budget 5 derives bounded per-run caps", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 0,
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(true);
    expect(budget.maxSearchQueries).toBeGreaterThan(0);
    expect(budget.maxSearchQueries).toBeLessThanOrEqual(5);
    expect(budget.maxLlmCalls).toBeLessThanOrEqual(20);
    expect(budget.estimatedRunAllowanceUsd).toBeGreaterThan(0);
  });

  it("exhausted budget skips paid work", () => {
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: 5,
      spentMonthToDateUsd: 5.01,
      now: new Date("2026-07-20T12:00:00Z"),
    });
    expect(budget.allowPaidSearch).toBe(false);
    expect(budget.maxSearchQueries).toBe(0);
    expect(budget.skipReasons).toContain("budget_capped");
  });

  it("counts 6-hour runs remaining in the month", () => {
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T18:00:00Z"))).toBe(1);
    expect(countRemainingRunsThisMonth(new Date("2026-07-31T00:00:00Z"))).toBe(4);
  });

  it("rejects non-free OpenRouter model IDs", () => {
    expect(() => rejectPaidOpenRouterModel("openai/gpt-4.1")).toThrow(/:free/);
    expect(rejectPaidOpenRouterModel("meta-llama/llama-3.3-70b-instruct:free")).toBe(
      "meta-llama/llama-3.3-70b-instruct:free",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/automationBudget.test.ts`

Expected: FAIL because `@/lib/automation/budget` does not exist.

- [ ] **Step 3: Add migration**

Create `supabase/migrations/0003_automation_signals.sql`:

```sql
alter table issue_clusters
  add column if not exists signal_count integer not null default 0,
  add column if not exists direct_report_count integer not null default 0,
  add column if not exists verified_report_count integer not null default 0,
  add column if not exists public_signal_count integer not null default 0,
  add column if not exists last_signal_at timestamptz,
  add column if not exists auto_public boolean not null default false,
  add column if not exists admin_visibility_override text check (admin_visibility_override in ('force_public','force_hidden'));

alter table source_signals drop constraint if exists source_signals_source_check;
alter table source_signals add constraint source_signals_source_check
  check (source in ('reddit','web_search','x_manual','x_search'));

alter table source_signals
  add column if not exists canonical_url text,
  add column if not exists title text,
  add column if not exists source_domain text,
  add column if not exists source_type text check (source_type in ('reddit','web_search','x_manual','x_search')),
  add column if not exists semantic_fingerprint text,
  add column if not exists cluster_id uuid references issue_clusters(id) on delete set null,
  add column if not exists public_status text not null default 'private' check (public_status in ('private','public','hidden')),
  add column if not exists promoted_at timestamptz,
  add column if not exists promotion_reason text,
  add column if not exists extraction_provider text not null default 'deterministic' check (extraction_provider in ('deterministic','openrouter')),
  add column if not exists extraction_model text,
  add column if not exists cost_estimate_usd numeric(10,6) not null default 0;

update source_signals set source_type = source where source_type is null;
update source_signals set canonical_url = source_url where canonical_url is null;
update source_signals set title = summary where title is null;

create index if not exists idx_signals_cluster on source_signals (cluster_id);
create index if not exists idx_signals_public on source_signals (public_status, observed_at desc);
create index if not exists idx_signals_semantic on source_signals (semantic_fingerprint);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  mode text not null default 'scheduled' check (mode in ('scheduled','manual','dry_run')),
  budget_monthly_usd numeric(10,2) not null default 5,
  budget_remaining_before_usd numeric(10,4) not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  reddit_posts_seen integer not null default 0,
  search_queries_used integer not null default 0,
  search_results_seen integer not null default 0,
  llm_calls_used integer not null default 0,
  signals_inserted integer not null default 0,
  signals_deduped integer not null default 0,
  clusters_promoted integer not null default 0,
  skips jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index if not exists idx_automation_runs_started on automation_runs (started_at desc);
create index if not exists idx_automation_runs_status on automation_runs (status);

alter table automation_runs enable row level security;
```

- [ ] **Step 4: Add environment knobs**

Append to `.env.local.example`:

```env
# --- automation-first signal monitor ---
AUTOMATION_BUDGET_USD_MONTHLY=5
AUTOMATION_SUBREDDITS=CrimsonDesert
TAVILY_API_KEY=
OPENROUTER_FREE_MODEL=meta-llama/llama-3.3-70b-instruct:free
```

- [ ] **Step 5: Implement env helpers**

Modify `src/lib/env.ts`:

```ts
type EnvLike = Record<string, string | undefined>;

export type Features = {
  turnstile: boolean;
  reddit: boolean;
  ai: boolean;
  xSearch: boolean;
  webSearch: boolean;
  automation: boolean;
};

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function automationBudgetUsd(env: EnvLike = process.env): number {
  const raw = env.AUTOMATION_BUDGET_USD_MONTHLY?.trim() ?? "5";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return Math.min(parsed, 50);
}

export function automationSubreddits(env: EnvLike = process.env): string[] {
  return (env.AUTOMATION_SUBREDDITS ?? "CrimsonDesert")
    .split(",")
    .map((subreddit) => subreddit.trim().replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, 5);
}

export function computeFeatures(env: EnvLike): Features {
  const reddit =
    hasEnvValue(env.REDDIT_CLIENT_ID) &&
    hasEnvValue(env.REDDIT_CLIENT_SECRET) &&
    hasEnvValue(env.REDDIT_USER_AGENT);
  const webSearch = hasEnvValue(env.TAVILY_API_KEY);
  return {
    turnstile: hasEnvValue(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && hasEnvValue(env.TURNSTILE_SECRET_KEY),
    reddit,
    ai: hasEnvValue(env.GROQ_API_KEY) || hasEnvValue(env.OPENROUTER_API_KEY),
    xSearch: hasEnvValue(env.XAI_API_KEY),
    webSearch,
    automation: reddit || webSearch,
  };
}

export function features(): Features {
  return computeFeatures(process.env);
}

export function requiredEnv(
  name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "ADMIN_PASSWORD" | "SESSION_SECRET",
): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
```

Update `tests/env.test.ts` expected feature objects to include `webSearch` and `automation`.

- [ ] **Step 6: Implement budget module**

Create `src/lib/automation/budget.ts`:

```ts
export type BudgetInput = {
  monthlyBudgetUsd: number;
  spentMonthToDateUsd: number;
  now: Date;
};

export type AutomationBudget = {
  monthlyBudgetUsd: number;
  remainingMonthUsd: number;
  remainingRuns: number;
  estimatedRunAllowanceUsd: number;
  allowPaidSearch: boolean;
  maxSearchQueries: number;
  maxSearchResults: number;
  maxLlmCalls: number;
  skipReasons: string[];
};

const RUN_INTERVAL_HOURS = 6;
const SEARCH_QUERY_COST_USD = 0.008;

export function countRemainingRunsThisMonth(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  const remainingMs = Math.max(0, end - now.getTime());
  return Math.max(1, Math.ceil(remainingMs / (RUN_INTERVAL_HOURS * 60 * 60 * 1000)));
}

export function rejectPaidOpenRouterModel(model: string): string {
  if (!model.endsWith(":free")) throw new Error("OpenRouter automation model must end with :free");
  return model;
}

export function computeAutomationBudget(input: BudgetInput): AutomationBudget {
  const monthlyBudgetUsd = Math.max(0, input.monthlyBudgetUsd);
  const remainingMonthUsd = Math.max(0, monthlyBudgetUsd - Math.max(0, input.spentMonthToDateUsd));
  const remainingRuns = countRemainingRunsThisMonth(input.now);
  const estimatedRunAllowanceUsd = remainingMonthUsd / remainingRuns;
  const skipReasons: string[] = [];

  if (monthlyBudgetUsd === 0) skipReasons.push("budget_zero");
  if (monthlyBudgetUsd > 0 && remainingMonthUsd <= 0) skipReasons.push("budget_capped");

  const allowPaidSearch = estimatedRunAllowanceUsd >= SEARCH_QUERY_COST_USD && skipReasons.length === 0;
  const queryBudget = allowPaidSearch ? Math.floor(estimatedRunAllowanceUsd / SEARCH_QUERY_COST_USD) : 0;
  const maxSearchQueries = Math.max(0, Math.min(5, queryBudget));

  return {
    monthlyBudgetUsd,
    remainingMonthUsd,
    remainingRuns,
    estimatedRunAllowanceUsd,
    allowPaidSearch,
    maxSearchQueries,
    maxSearchResults: maxSearchQueries * 5,
    maxLlmCalls: allowPaidSearch ? Math.min(20, maxSearchQueries * 4) : 0,
    skipReasons,
  };
}
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/automationBudget.test.ts tests/env.test.ts
npm run build
```

Expected: tests pass and build succeeds.

Commit:

```bash
git add .env.local.example src/lib/env.ts src/lib/automation/budget.ts tests/automationBudget.test.ts tests/env.test.ts supabase/migrations/0003_automation_signals.sql
git commit -m "feat: automation schema and one-knob budget guardrails"
```

---

## Task 2: Extraction, Dedupe, Search Planning, And Promotion Rules

**Files:**
- Create: `src/lib/automation/dedupe.ts`
- Create: `src/lib/automation/extract.ts`
- Create: `src/lib/automation/promote.ts`
- Create: `src/lib/automation/search.ts`
- Test: `tests/automationLogic.test.ts`

- [ ] **Step 1: Write failing pure logic tests**

Create `tests/automationLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalizeUrl, semanticFingerprint } from "@/lib/automation/dedupe";
import { deterministicExtract, parseOpenRouterExtraction } from "@/lib/automation/extract";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { buildSearchQueries } from "@/lib/automation/search";

describe("automation dedupe", () => {
  it("canonicalizes URLs and ignores tracking params", () => {
    expect(canonicalizeUrl("https://example.com/post?utm_source=x&id=1#comments")).toBe("https://example.com/post?id=1");
  });

  it("builds stable semantic fingerprints", () => {
    expect(semanticFingerprint("FPS drops since 1.13!", "performance")).toBe(
      semanticFingerprint("fps   drops since 1.13", "performance"),
    );
  });
});

describe("automation extraction", () => {
  it("deterministically classifies common issue language", () => {
    const result = deterministicExtract({
      title: "Crimson Desert map crash still happens",
      snippet: "Game crashes to desktop when opening the map after patch 1.13.",
      url: "https://example.com/a",
    });
    expect(result.category).toBe("crash_startup");
    expect(result.confidence).toBe("medium");
    expect(result.issueTitle).toContain("map crash");
  });

  it("parses strict OpenRouter JSON and rejects invalid categories", () => {
    expect(
      parseOpenRouterExtraction(
        JSON.stringify({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "high",
          summary: "Multiple PC players mention FPS drops after patch 1.13.",
        }),
      ).category,
    ).toBe("performance");
    expect(() => parseOpenRouterExtraction(JSON.stringify({ category: "made_up" }))).toThrow(/category/);
  });
});

describe("automation promotion", () => {
  it("keeps one weak source private", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 1,
        directReportCount: 0,
        highestConfidence: "low",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("private");
  });

  it("promotes two independent sources", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 2,
        directReportCount: 0,
        highestConfidence: "medium",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("public");
  });

  it("direct report promotes a matching signal", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 1,
        directReportCount: 1,
        highestConfidence: "low",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("public");
  });

  it("force hidden wins over threshold", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 3,
        directReportCount: 3,
        highestConfidence: "high",
        hasAdminForcePublic: true,
        hasAdminForceHidden: true,
      }).publicStatus,
    ).toBe("hidden");
  });
});

describe("search planning", () => {
  it("never emits more queries than the cap", () => {
    expect(buildSearchQueries(3)).toHaveLength(3);
    expect(buildSearchQueries(0)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/automationLogic.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement dedupe module**

Create `src/lib/automation/dedupe.ts`:

```ts
import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function semanticFingerprint(title: string, category: string): string {
  return hashValue(`${category}|${normalizeText(title)}`);
}
```

- [ ] **Step 4: Implement extraction module**

Create `src/lib/automation/extract.ts`:

```ts
import { CATEGORIES, PLATFORMS, type Category, type Platform } from "@/lib/constants";
import { classifySignal, summarize } from "@/lib/reddit";

export type SourceCandidate = {
  title: string;
  snippet: string;
  url: string;
};

export type ExtractedSignal = {
  issueTitle: string;
  category: Category;
  platform: Platform | null;
  confidence: "low" | "medium" | "high";
  summary: string;
};

const platformPatterns: { platform: Platform; patterns: RegExp[] }[] = [
  { platform: "pc_steam", patterns: [/\bpc\b/i, /\bsteam\b/i, /\brtx\b/i, /\bgtx\b/i] },
  { platform: "ps5_pro", patterns: [/ps5 pro/i] },
  { platform: "ps5", patterns: [/\bps5\b/i, /playstation 5/i] },
  { platform: "xbox_series_x", patterns: [/series x/i] },
  { platform: "xbox_series_s", patterns: [/series s/i] },
];

function asCategory(value: unknown): Category {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) return value as Category;
  throw new Error("invalid extraction category");
}

function asPlatform(value: unknown): Platform | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && (PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new Error("invalid extraction platform");
}

function asConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("invalid extraction confidence");
}

export function deterministicExtract(candidate: SourceCandidate): ExtractedSignal {
  const text = `${candidate.title} ${candidate.snippet}`;
  const classified = classifySignal(text);
  const platform = platformPatterns.find((entry) => entry.patterns.some((pattern) => pattern.test(text)))?.platform ?? null;
  const issueTitle = candidate.title.replace(/\s+/g, " ").trim().slice(0, 120) || "Crimson Desert community signal";
  return {
    issueTitle,
    category: classified.category,
    platform,
    confidence: classified.confidence,
    summary: summarize(issueTitle, candidate.snippet),
  };
}

export function parseOpenRouterExtraction(content: string): ExtractedSignal {
  const parsed = JSON.parse(content) as {
    issueTitle?: unknown;
    category?: unknown;
    platform?: unknown;
    confidence?: unknown;
    summary?: unknown;
  };
  const issueTitle = typeof parsed.issueTitle === "string" ? parsed.issueTitle.trim().slice(0, 120) : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 280) : "";
  if (!issueTitle) throw new Error("invalid extraction issueTitle");
  if (!summary) throw new Error("invalid extraction summary");
  return {
    issueTitle,
    category: asCategory(parsed.category),
    platform: asPlatform(parsed.platform),
    confidence: asConfidence(parsed.confidence),
    summary,
  };
}
```

- [ ] **Step 5: Implement promotion module**

Create `src/lib/automation/promote.ts`:

```ts
export type PromotionInput = {
  independentSourceCount: number;
  directReportCount: number;
  highestConfidence: "low" | "medium" | "high";
  hasAdminForcePublic: boolean;
  hasAdminForceHidden: boolean;
};

export type PromotionDecision = {
  publicStatus: "private" | "public" | "hidden";
  reason: string;
};

export function shouldPromoteSignalCluster(input: PromotionInput): PromotionDecision {
  if (input.hasAdminForceHidden) return { publicStatus: "hidden", reason: "admin_force_hidden" };
  if (input.hasAdminForcePublic) return { publicStatus: "public", reason: "admin_force_public" };
  if (input.directReportCount > 0) return { publicStatus: "public", reason: "direct_report_match" };
  if (input.independentSourceCount >= 2) return { publicStatus: "public", reason: "two_independent_sources" };
  if (input.highestConfidence === "high" && input.independentSourceCount >= 1) {
    return { publicStatus: "public", reason: "single_high_confidence_source" };
  }
  return { publicStatus: "private", reason: "below_threshold" };
}

export function weightedClusterScore(input: {
  publicSignalCount: number;
  directReportCount: number;
  verifiedReportCount: number;
  lastSignalAt: string | null;
}): number {
  const recency = input.lastSignalAt ? Math.max(0, 14 - (Date.now() - new Date(input.lastSignalAt).getTime()) / 86400000) : 0;
  return input.publicSignalCount + input.directReportCount * 3 + input.verifiedReportCount * 5 + recency / 10;
}
```

- [ ] **Step 6: Implement search planning module**

Create `src/lib/automation/search.ts`:

```ts
import "server-only";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string | null;
  observedAt: string;
};

const QUERY_PACK = [
  "Crimson Desert patch 1.13 FPS",
  "Crimson Desert 1.13 crash",
  "Crimson Desert map crash",
  "Crimson Desert PS5 Pro performance",
  "Crimson Desert Steam stutter",
];

export function buildSearchQueries(maxQueries: number): string[] {
  return QUERY_PACK.slice(0, Math.max(0, maxQueries));
}

export async function tavilySearch(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
  });
  if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? [])
    .filter((item) => item.title && item.url)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.content ?? "",
      sourceDomain: item.url ? new URL(item.url).hostname.replace(/^www\./, "") : null,
      observedAt: new Date().toISOString(),
    }));
}
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/automationLogic.test.ts tests/reddit.test.ts
npm run build
```

Expected: tests pass and build succeeds.

Commit:

```bash
git add src/lib/automation tests/automationLogic.test.ts
git commit -m "feat: automation extraction dedupe search and promotion rules"
```

---

## Task 3: Automation Runner, Cron, And Admin Actions

**Files:**
- Create: `src/lib/automation/run.ts`
- Modify: `src/app/api/cron/keepalive/route.ts`
- Modify: `src/app/admin/actions.ts`
- Test: `tests/automationRun.test.ts`

- [ ] **Step 1: Write integration tests with mocked providers**

Create `tests/automationRun.test.ts` with mocked Supabase and provider functions:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const tableCalls: Record<string, unknown[]> = {};
const fromMock = vi.fn((table: string) => {
  tableCalls[table] ??= [];
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn(async (row: unknown) => {
      tableCalls[table].push(row);
      return { data: Array.isArray(row) ? row : [row], error: null };
    }),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn(async (row: unknown) => {
      tableCalls[table].push(row);
      return { data: [row], error: null };
    }),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: [], error: null })),
    single: vi.fn(async () => ({ data: { id: "run-1" }, error: null })),
  };
});

vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: fromMock }) }));
vi.mock("@/lib/reddit.server", () => ({
  getRedditToken: vi.fn(async () => "token"),
  fetchNewPosts: vi.fn(async () => [
    {
      id: "abc",
      title: "FPS drops since 1.13",
      selftext: "Steam users are seeing stutter.",
      permalink: "/r/CrimsonDesert/comments/abc/fps/",
      created_utc: 1783260000,
    },
  ]),
}));
vi.mock("@/lib/automation/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/search")>();
  return {
    ...actual,
    tavilySearch: vi.fn(async () => [
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://example.com/fps",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00Z",
      },
    ]),
  };
});

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.REDDIT_CLIENT_ID = "id";
process.env.REDDIT_CLIENT_SECRET = "secret";
process.env.REDDIT_USER_AGENT = "agent";
process.env.TAVILY_API_KEY = "tavily";
process.env.AUTOMATION_BUDGET_USD_MONTHLY = "5";

import { runAutomationMonitor } from "@/lib/automation/run";

beforeEach(() => {
  for (const key of Object.keys(tableCalls)) delete tableCalls[key];
  fromMock.mockClear();
});

describe("runAutomationMonitor", () => {
  it("writes an automation run and source signals without real network", async () => {
    const result = await runAutomationMonitor({ mode: "dry_run", now: new Date("2026-07-05T12:00:00Z") });
    expect(result.status).toBe("success");
    expect(result.redditPostsSeen).toBe(1);
    expect(result.searchResultsSeen).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("budget 0 skips search and llm paid work", async () => {
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "0";
    const result = await runAutomationMonitor({ mode: "dry_run", now: new Date("2026-07-05T12:00:00Z") });
    expect(result.skips).toContain("budget_zero");
    expect(result.searchQueriesUsed).toBe(0);
    process.env.AUTOMATION_BUDGET_USD_MONTHLY = "5";
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/automationRun.test.ts`

Expected: FAIL because `runAutomationMonitor` does not exist.

- [ ] **Step 3: Implement automation runner**

Create `src/lib/automation/run.ts`:

```ts
import "server-only";

import { externalIdHash } from "@/lib/crypto";
import { automationBudgetUsd, automationSubreddits, features } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { computeAutomationBudget } from "@/lib/automation/budget";
import { canonicalizeUrl, hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { deterministicExtract } from "@/lib/automation/extract";
import { buildSearchQueries, tavilySearch, type SearchResult } from "@/lib/automation/search";

export type AutomationMode = "scheduled" | "manual" | "dry_run";

export type AutomationResult = {
  status: "success" | "partial" | "failed" | "skipped";
  redditPostsSeen: number;
  searchQueriesUsed: number;
  searchResultsSeen: number;
  llmCallsUsed: number;
  signalsInserted: number;
  signalsDeduped: number;
  clustersPromoted: number;
  estimatedCostUsd: number;
  skips: string[];
  errors: string[];
};

type SourceInput = {
  source: "reddit" | "web_search";
  id: string;
  title: string;
  body: string;
  url: string;
  observedAt: string;
  sourceDomain: string | null;
};

function searchResultToInput(result: SearchResult): SourceInput {
  return {
    source: "web_search",
    id: result.url,
    title: result.title,
    body: result.snippet,
    url: result.url,
    observedAt: result.observedAt,
    sourceDomain: result.sourceDomain,
  };
}

export async function runAutomationMonitor(input: { mode: AutomationMode; now?: Date }): Promise<AutomationResult> {
  const now = input.now ?? new Date();
  const supabase = createServiceClient();
  const { data: monthRuns } = await supabase
    .from("automation_runs")
    .select("estimated_cost_usd")
    .gte("started_at", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
  const spent = (monthRuns ?? []).reduce((sum: number, row: { estimated_cost_usd?: number }) => sum + Number(row.estimated_cost_usd ?? 0), 0);
  const budget = computeAutomationBudget({ monthlyBudgetUsd: automationBudgetUsd(), spentMonthToDateUsd: spent, now });

  const result: AutomationResult = {
    status: "success",
    redditPostsSeen: 0,
    searchQueriesUsed: 0,
    searchResultsSeen: 0,
    llmCallsUsed: 0,
    signalsInserted: 0,
    signalsDeduped: 0,
    clustersPromoted: 0,
    estimatedCostUsd: 0,
    skips: [...budget.skipReasons],
    errors: [],
  };

  const signals: SourceInput[] = [];
  const f = features();

  if (f.reddit) {
    try {
      const token = await getRedditToken();
      for (const subreddit of automationSubreddits()) {
        const posts = await fetchNewPosts(subreddit, token, 25);
        result.redditPostsSeen += posts.length;
        for (const post of posts) {
          signals.push({
            source: "reddit",
            id: post.id,
            title: post.title,
            body: post.selftext ?? "",
            url: `https://www.reddit.com${post.permalink}`,
            observedAt: new Date(post.created_utc * 1000).toISOString(),
            sourceDomain: "reddit.com",
          });
        }
      }
    } catch (error) {
      result.status = "partial";
      result.errors.push(error instanceof Error ? error.message : "reddit failed");
    }
  } else {
    result.skips.push("reddit_disabled");
  }

  if (f.webSearch && budget.allowPaidSearch) {
    for (const query of buildSearchQueries(budget.maxSearchQueries)) {
      try {
        result.searchQueriesUsed += 1;
        result.estimatedCostUsd += 0.008;
        const found = await tavilySearch(query);
        result.searchResultsSeen += found.length;
        signals.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        result.errors.push(error instanceof Error ? error.message : "search failed");
      }
    }
  } else if (!f.webSearch) {
    result.skips.push("search_disabled");
  }

  const seen = new Set<string>();
  const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  for (const signal of signals.slice(0, Math.max(25, budget.maxSearchResults + 25))) {
    const canonicalUrl = canonicalizeUrl(signal.url);
    const extracted = deterministicExtract({ title: signal.title, snippet: signal.body, url: canonicalUrl });
    const semantic = semanticFingerprint(extracted.issueTitle, extracted.category);
    if (seen.has(canonicalUrl) || seen.has(semantic)) {
      result.signalsDeduped += 1;
      continue;
    }
    seen.add(canonicalUrl);
    seen.add(semantic);

    if (input.mode !== "dry_run") {
      const { error } = await supabase.from("source_signals").upsert(
        {
          source: signal.source,
          source_type: signal.source,
          source_url: canonicalUrl,
          canonical_url: canonicalUrl,
          external_id_hash: externalIdHash(signal.source, signal.id),
          title: signal.title.slice(0, 240),
          source_domain: signal.sourceDomain,
          semantic_fingerprint: semantic,
          summary: extracted.summary,
          extracted_facts: { issueTitle: extracted.issueTitle, platform: extracted.platform },
          category: extracted.category,
          confidence: extracted.confidence,
          observed_at: signal.observedAt,
          raw_text: signal.body.slice(0, 8000) || null,
          raw_expires_at: signal.body ? expires : null,
          public_status: "private",
          extraction_provider: "deterministic",
          cost_estimate_usd: 0,
        },
        { onConflict: "external_id_hash", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    }
    result.signalsInserted += 1;
  }

  if (input.mode !== "dry_run") {
    await supabase.from("automation_runs").insert({
      status: result.status,
      mode: input.mode,
      finished_at: new Date().toISOString(),
      budget_monthly_usd: budget.monthlyBudgetUsd,
      budget_remaining_before_usd: budget.remainingMonthUsd,
      estimated_cost_usd: result.estimatedCostUsd,
      reddit_posts_seen: result.redditPostsSeen,
      search_queries_used: result.searchQueriesUsed,
      search_results_seen: result.searchResultsSeen,
      llm_calls_used: result.llmCallsUsed,
      signals_inserted: result.signalsInserted,
      signals_deduped: result.signalsDeduped,
      clusters_promoted: result.clustersPromoted,
      skips: result.skips,
      errors: result.errors,
    });
  }

  return result;
}
```

- [ ] **Step 4: Update cron route**

Modify `src/app/api/cron/keepalive/route.ts` so after purge it runs automation at most every 6 hours:

```ts
import { NextResponse } from "next/server";
import { runAutomationMonitor } from "@/lib/automation/run";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);
  const { error: purgeError } = await supabase
    .from("source_signals")
    .update({ raw_text: null, raw_expires_at: null })
    .lt("raw_expires_at", new Date().toISOString())
    .not("raw_text", "is", null);

  let automation: Awaited<ReturnType<typeof runAutomationMonitor>> | { status: "skipped"; reason: string } = {
    status: "skipped",
    reason: "recent_run",
  };
  const { data: recent } = await supabase
    .from("automation_runs")
    .select("started_at")
    .gte("started_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1);
  if ((recent ?? []).length === 0) {
    automation = await runAutomationMonitor({ mode: "scheduled" });
  }

  return NextResponse.json({
    ok: !touchError && !purgeError,
    touch: touchError?.message ?? "ok",
    purge: purgeError?.message ?? "ok",
    automation,
  });
}
```

- [ ] **Step 5: Update admin actions**

Add to `src/app/admin/actions.ts`:

```ts
import { runAutomationMonitor } from "@/lib/automation/run";

export async function runAutomationDryScan(): Promise<void> {
  await requireAdmin();
  await runAutomationMonitor({ mode: "dry_run" });
  revalidatePath("/admin/source-monitor");
}

export async function runAutomationCappedScan(): Promise<void> {
  await requireAdmin();
  await runAutomationMonitor({ mode: "manual" });
  revalidatePath("/admin/source-monitor");
  revalidatePath("/");
  revalidatePath("/issues");
}
```

Keep `runRedditMonitor` only if still used; otherwise migrate `/admin/source-monitor` to the new actions.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/automationRun.test.ts tests/automationBudget.test.ts tests/automationLogic.test.ts
npm run build
```

Expected: tests pass and build succeeds.

Commit:

```bash
git add src/lib/automation/run.ts src/app/api/cron/keepalive/route.ts src/app/admin/actions.ts tests/automationRun.test.ts
git commit -m "feat: scheduled automation runner with capped dry and manual scans"
```

---

## Task 4: Public Queries, Dashboard, Issues, And Admin Observability

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/issues/page.tsx`
- Modify: `src/app/admin/source-monitor/page.tsx`
- Modify: `tests/e2e/mock-dev-server.mjs`
- Modify: `tests/e2e/public-visual.spec.ts`

- [ ] **Step 1: Update mock server data**

In `tests/e2e/mock-dev-server.mjs`, add public `source_signals` rows with:

```js
{
  id: "signal-1",
  source: "reddit",
  source_type: "reddit",
  source_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/fps/",
  canonical_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/fps",
  title: "FPS drops since patch 1.13",
  source_domain: "reddit.com",
  semantic_fingerprint: "mock-fps",
  cluster_id: "cluster-fps",
  public_status: "public",
  summary: "FPS drops since patch 1.13 (body retained for 48h moderator review)",
  category: "performance",
  confidence: "medium",
  observed_at: isoMinutesAgo(12),
}
```

Add at least two public signals for `cluster-fps`, one private low-confidence signal for a non-public issue, and one automation run row.

Add mock routes for:

- `GET /rest/v1/automation_runs`
- `GET /rest/v1/source_signals` filtering `public_status=eq.public`

- [ ] **Step 2: Update query layer**

Modify `src/lib/queries.ts`:

```ts
export type SignalRow = {
  id: string;
  cluster_id: string | null;
  source: string;
  source_url: string;
  summary: string;
  category: string;
  confidence: "low" | "medium" | "high";
  observed_at: string;
  public_status: "private" | "public" | "hidden";
};

export type AutomationRunRow = {
  id: string;
  started_at: string;
  status: string;
  estimated_cost_usd: number;
  search_queries_used: number;
  llm_calls_used: number;
  signals_inserted: number;
  signals_deduped: number;
  clusters_promoted: number;
  skips: string[];
  errors: string[];
};
```

In `getDashboardData`, query public signals:

```ts
const { data: signals } = await supabase
  .from("source_signals")
  .select("id, cluster_id, source, source_url, summary, category, confidence, observed_at, public_status")
  .eq("public_status", "public");
const signalRows = (signals ?? []) as SignalRow[];
```

Return:

```ts
communitySignals: signalRows.length,
directReports: rows.length,
verifiedReports: rows.length,
signalByCategory: countBy(signalRows, (row) => row.category),
topClusters: rankClusters(clusterData ?? [], rows).map((cluster) => ({
  ...cluster,
  signalCount: signalRows.filter((signal) => signal.cluster_id === cluster.id).length,
  directReportCount: rows.filter((report) => report.cluster_id === cluster.id).length,
}))
  .filter((cluster) => cluster.count > 0 || cluster.signalCount > 0)
  .sort((a, b) => b.signalCount + b.directReportCount * 3 - (a.signalCount + a.directReportCount * 3)),
```

In `getIssuesData`, include public signals grouped by cluster.

Add `getAutomationAdminData` that returns latest 20 signals and latest 10 automation runs.

- [ ] **Step 3: Update dashboard UI**

Modify `src/app/page.tsx`:

- Hero copy: “Automated community signals plus direct reports…”
- Stat cards:
  - `Community signals` = `d.communitySignals`
  - `Direct reports` = `d.directReports`
  - `Verified reports` = `d.verifiedReports`
  - `Awaiting review` = `d.pendingCount`
- Top issue row count text:
  - `${cluster.signalCount} signals · ${cluster.directReportCount} reports`
- Caption: “Ranked by public community signals and approved direct reports.”

- [ ] **Step 4: Update issues UI**

Modify `src/app/issues/page.tsx` to show each cluster with:

- `Community signals` section listing up to 3 public summaries and source links.
- `Approved excerpts` section for verified direct report excerpts.
- Empty text for each section if absent.

- [ ] **Step 5: Update admin source monitor UI**

Modify `src/app/admin/source-monitor/page.tsx`:

- Show current monthly budget using `automationBudgetUsd()`.
- Show latest automation runs table.
- Replace Reddit-only form with:
  - `Run dry scan`
  - `Run capped scan now`
- Show `skips` and `errors`.
- Show recent signals with public/private status.

- [ ] **Step 6: Update Playwright assertions**

Modify `tests/e2e/public-visual.spec.ts` dashboard test:

```ts
await expect(page.getByText("Community signals")).toBeVisible();
await expect(page.getByText("Direct reports")).toBeVisible();
await expect(page.getByText(/signals .* reports/)).toBeVisible();
```

Modify issues test:

```ts
await expect(page.getByText("Community signals").first()).toBeVisible();
await expect(page.getByText("Approved excerpts").first()).toBeVisible();
await expect(page.getByText("private low confidence")).toHaveCount(0);
```

- [ ] **Step 7: Verify, update screenshots, and commit**

Run:

```bash
npm run test:e2e:update
npm run test:e2e
npm test
npm run build
```

Expected: Playwright baselines update, visual tests pass, unit tests pass, build succeeds.

Commit:

```bash
git add src/lib/queries.ts src/app/page.tsx src/app/issues/page.tsx src/app/admin/source-monitor/page.tsx tests/e2e
git commit -m "feat: public automation signal dashboard and admin observability"
```

---

## Task 5: Dossier, Docs, And Final Gates

**Files:**
- Modify: `src/lib/dossier.ts`
- Modify: `src/app/admin/actions.ts`
- Modify: `tests/dossier.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Update dossier test**

Modify `tests/dossier.test.ts` to include signal counts and assert output includes:

```ts
expect(out).toContain("Community signals");
expect(out).toContain("Direct reports");
expect(out).toContain("Verified reports");
```

- [ ] **Step 2: Update dossier types and output**

Modify `src/lib/dossier.ts`:

- Add `totalSignals`, `totalDirectReports`, `totalVerifiedReports`.
- Add each cluster’s `signalCount`, `directReportCount`, `verifiedReportCount`.
- Add section `## Community signal summary`.
- Keep deterministic output as the source of truth.

- [ ] **Step 3: Update compile action**

Modify `compileDossier` in `src/app/admin/actions.ts` to query public `source_signals`, include signal counts in clusters, and pass new totals to `buildDeterministicDossier`.

- [ ] **Step 4: Update README**

Add:

```md
## Automation

Set `AUTOMATION_BUDGET_USD_MONTHLY=5` to cap monthly automation spend. Set it to `0` for Reddit-only/free deterministic monitoring. Search uses `TAVILY_API_KEY` when present. OpenRouter automation extraction only accepts model IDs ending in `:free`.

Scheduled automation runs from `/api/cron/keepalive` at most once every 6 hours. Public dashboard counts separate community signals, direct reports, and verified reports.
```

- [ ] **Step 5: Final verification**

Run:

```bash
npm test
npm run build
npm run test:e2e
```

Expected:

- All Vitest tests pass.
- Next production build succeeds.
- Playwright visual regression suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dossier.ts src/app/admin/actions.ts tests/dossier.test.ts README.md
git commit -m "feat: include automation signals in dossiers and docs"
```

---

## Completion Checklist

- [ ] `AUTOMATION_BUDGET_USD_MONTHLY` is the only user-facing cost knob.
- [ ] OpenRouter automation model IDs must end with `:free`.
- [ ] Cron runs automation at most once every 6 hours.
- [ ] Budget `0` prevents paid search.
- [ ] Dashboard separates community signals, direct reports, and verified reports.
- [ ] One weak source does not appear publicly.
- [ ] Two independent sources can promote public.
- [ ] Direct report strengthens/promotes a matching signal.
- [ ] Admin source monitor shows budget, run history, skips, errors, and recent signals.
- [ ] Dossier separates automated signals from direct/verified evidence.
- [ ] Unit tests, production build, and Playwright visual tests pass.
