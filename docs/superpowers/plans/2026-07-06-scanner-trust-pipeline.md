# Scanner Trust Pipeline Implementation Plan

> **HISTORICAL / SUPERSEDED (2026-07-09). DO NOT EXECUTE.** The owner-approved [Confirmation Board design](../specs/2026-07-09-confirmation-board-design.md) and its [implementation record](2026-07-09-confirmation-board.md) replace this plan wherever they differ. Scanner URLs are leads rather than evidence, Reddit API is permanently off, and the retired evidence-ladder/status dialects must not be restored. The unchecked boxes below preserve the original plan; they are not an active backlog.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the automated scanner cheap-filter before LLM use, route scanner evidence into the seeded watchlist clusters, harden promotion so no single unreviewed source publishes, give the admin a per-run funnel + rescue queue, extract official patch-note claimed fixes into a public checklist, surface an honest four-state evidence ladder on public pages, and make the Evidence Assistant explainable with preview-before-insert.

**Architecture:** Next.js 15 App Router + Supabase (service client, RLS-locked tables). All scanner logic is pure functions in `src/lib/automation/*` orchestrated by `runAutomationMonitor` in `src/lib/automation/run.ts`. Tests are Vitest in `tests/*.test.ts` (no React component test infra — UI is verified by `npm run build` + lint; pure helpers get unit tests). DB changes are SQL files in `supabase/migrations/` named `YYYYMMDDHHMMSS_name.sql` (use 202607061xxxxx timestamps, strictly increasing per task).

**Tech Stack:** TypeScript, Next.js 15, Supabase JS, Vitest, Tailwind-ish utility classes via `src/app/globals.css` custom classes (`panel`, `badge`, `stat-label`, `btn`, etc. — reuse them, don't invent new CSS).

**Conventions that MUST be followed:**
- Run tests with `npx vitest run` (all) or `npx vitest run tests/<file>.test.ts`.
- Run lint with `npm run lint`; build with `npm run build`. Both must pass before each commit.
- Server-only modules import `"server-only"`. Pure-logic modules (testable) must NOT import `"server-only"` — note `tests/server-only-stub.ts` exists and vitest aliases it, so importing server modules in tests works, but prefer pure modules.
- Supabase reads/writes: always check `error` and throw `new Error(\`<label> failed: ${error.message}\`)`.
- Colors/styling: inline `style={{ color: "var(--text-dim)" }}` pattern and existing badge classes (`badge badge-green|amber|crimson|dim|blue`).
- Commit after each task with a conventional message. Never commit `docs/superpowers/plans/` changes in feature commits (plan file is committed separately at the start).

---

## Task 1: Cheap filters before LLM + funnel counters

**Problem:** `prepareSignals` in `src/lib/automation/run.ts` calls `extractSignalWithOpenRouter` for EVERY deduped input, then `shouldKeepAutomatedSignal` rejects most of them using regex checks that only need raw title/snippet. LLM calls are wasted on candidates a free regex would kill.

**Files:**
- Modify: `src/lib/automation/relevance.ts` (split into pre-screen + post-extraction checks)
- Modify: `src/lib/automation/run.ts` (`prepareSignals`, `AutomationResult`, `insertRunLedger`)
- Create: `supabase/migrations/20260706100000_automation_run_funnel.sql`
- Modify: `tests/automationLogic.test.ts` (relevance tests)
- Modify: `tests/automationRun.test.ts` (run orchestration tests)

**Design:** Split relevance into two pure functions. Deliberate trade-off (document in a code comment): a source whose raw title+snippet has no symptom language is rejected WITHOUT giving the LLM a chance to rescue it. That rescue path was the waste.

New `src/lib/automation/relevance.ts` API (keep `RelevanceSkipReason` values identical so `runDisplay.ts` labels keep working):

```ts
import type { ExtractionResult } from "@/lib/automation/extract";
import { CURRENT_PATCH } from "@/lib/constants";

export type RelevanceSkipReason = "category_other" | "source_not_issue_report" | "wrong_patch";
export type SignalRelevanceDecision = { keep: true } | { keep: false; reason: RelevanceSkipReason };

export type CandidatePreScreenInput = {
  title: string;
  snippet: string;
  sourceDomain: string | null;
};

// ... keep the existing SYMPTOM_PATTERNS, BROAD_CONTENT_PATTERNS, NO_ISSUE_PATTERNS,
// compact, matchesAny, hasSymptomLanguage, saysNoIssue, isBroadContentTitle,
// normalizePatch, explicitPatchVersions, mentionsOnlyOtherPatch — UNCHANGED.

/** Cheap gate on raw source text. Runs BEFORE any LLM call. */
export function preScreenCandidate(
  input: CandidatePreScreenInput,
  options: { currentPatchVersion?: string } = {},
): SignalRelevanceDecision {
  const sourceText = compact(`${input.title} ${input.snippet}`);
  if (mentionsOnlyOtherPatch(sourceText, options.currentPatchVersion ?? CURRENT_PATCH)) {
    return { keep: false, reason: "wrong_patch" };
  }
  if (isBroadContentTitle(input.title)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  if (!hasSymptomLanguage(sourceText) || saysNoIssue(sourceText)) {
    return { keep: false, reason: "source_not_issue_report" };
  }
  return { keep: true };
}

/** Post-extraction gate. Runs AFTER extraction (deterministic or LLM). */
export function shouldKeepExtractedSignal(extraction: ExtractionResult): SignalRelevanceDecision {
  if (extraction.category === "other") {
    return { keep: false, reason: "category_other" };
  }
  return { keep: true };
}
```

Delete `shouldKeepAutomatedSignal` and its `SignalRelevanceInput` type entirely; update all call sites and tests.

`prepareSignals` in run.ts becomes (order matters):
1. canonicalize URL (existing)
2. dedupe by URL/external hash (existing) → increments `signalsDeduped`
3. `preScreenCandidate` on raw title/snippet → on reject: push reason to `result.skips`, increment `result.prefilterRejected`, `continue` — **no LLM call happens**
4. `extractSignalWithOpenRouter` (existing call, unchanged options)
5. `shouldKeepExtractedSignal` on the extraction → on reject: push reason, `continue`
6. push to `prepared`, increment `signalsInserted`

Add to `AutomationResult` type: `candidatesSeen: number` (count of inputs entering step 1) and `prefilterRejected: number`. Initialize to 0 in `runAutomationMonitor`.

Migration `20260706100000_automation_run_funnel.sql`:

```sql
alter table automation_runs
  add column if not exists funnel jsonb not null default '{}'::jsonb;
```

In `insertRunLedger`, add to the inserted row:

```ts
funnel: {
  candidatesSeen: result.candidatesSeen,
  deduped: result.signalsDeduped,
  prefilterRejected: result.prefilterRejected,
  llmCalls: result.llmCallsUsed,
  kept: result.signalsInserted,
  promoted: result.clustersPromoted,
},
```

- [ ] **Step 1: Write failing tests for the relevance split** in `tests/automationLogic.test.ts`. Replace tests of `shouldKeepAutomatedSignal` with tests of the two new functions. Required cases:
  - `preScreenCandidate` rejects `{title: "Crimson Desert patch notes", snippet: "..."}` with `source_not_issue_report`
  - rejects `{title: "Game crashes on map open", snippet: "since patch 1.12"}` with `wrong_patch` when `currentPatchVersion: "1.13.00"`
  - rejects `{title: "Nice scenery tour", snippet: "beautiful vistas"}` (no symptom) with `source_not_issue_report`
  - keeps `{title: "FPS drops hard in combat", snippet: "since 1.13 stutters constantly"}`
  - rejects `{title: "No crashes for me", snippet: "runs without issues"}` (no-issue language) with `source_not_issue_report`
  - `shouldKeepExtractedSignal` rejects extraction with `category: "other"`, keeps `category: "performance"`
- [ ] **Step 2: Run to verify failures:** `npx vitest run tests/automationLogic.test.ts` — expect failures/compile errors.
- [ ] **Step 3: Implement `relevance.ts` split** per the code above.
- [ ] **Step 4: Write failing test in `tests/automationRun.test.ts`:** a run whose search results all fail pre-screen (e.g. titles are "patch notes"/"review") makes **zero** LLM calls. Follow the existing test setup in that file (it stubs supabase + fetchers); assert the OpenRouter fetcher mock was never invoked and `result.llmCallsUsed === 0`, and that `funnel` fields land in the inserted run row (`candidatesSeen`, `prefilterRejected` correct).
- [ ] **Step 5: Update `run.ts`** per the design (reorder, new counters, funnel in ledger). Update any other caller of `shouldKeepAutomatedSignal` (search repo-wide).
- [ ] **Step 6: Create the migration file** exactly as above.
- [ ] **Step 7: Run all tests + lint + build:** `npx vitest run && npm run lint && npm run build` — all green.
- [ ] **Step 8: Commit:** `feat(scanner): run cheap relevance gates before LLM extraction, record run funnel`

---

## Task 2: Route scanner signals into seeded watchlist clusters

**Problem:** `resolveClusterId` in run.ts only matches by exact semantic fingerprint or creates a brand-new `auto-*` cluster. Scanner evidence can NEVER attach to the six seeded watchlist clusters (slugs: `performance_regression`, `crash_startup_hang`, `map_open_crash_persistent`, `boss_rematch_crash_persistent`, `controls_input_gameplay`, `hardware_driver_specific`), so the public watchlist stays at zero forever. This is the site's core promise being structurally broken.

**Files:**
- Create: `src/lib/automation/route.ts` (pure routing logic)
- Create: `tests/automationRoute.test.ts`
- Modify: `src/lib/automation/extract.ts` (prompt asks for `clusterSlug`; parser validates it)
- Modify: `src/lib/automation/run.ts` (load routable clusters, use routing in `resolveClusterId`)
- Modify: `tests/automationLogic.test.ts` (extraction parser tests)

**Design — `src/lib/automation/route.ts`:**

```ts
import type { Category } from "@/lib/constants";

export type RoutableCluster = {
  id: string;
  slug: string;
  title: string;
  category: Category | string;
};

export type RoutingInput = {
  issueTitle: string;
  summary: string;
  category: Category;
  /** clusterSlug proposed by the LLM, already validated against known slugs (or null). */
  llmClusterSlug: string | null;
};

const KEYWORD_ROUTES: { slug: string; category: Category; patterns: RegExp[] }[] = [
  { slug: "map_open_crash_persistent", category: "crash_startup", patterns: [/\bmap\b/i] },
  { slug: "boss_rematch_crash_persistent", category: "crash_startup", patterns: [/\bboss\b/i, /\brematch\b/i] },
  { slug: "crash_startup_hang", category: "crash_startup", patterns: [/crash/i, /freez/i, /hang/i, /\bctd\b/i, /won'?t (start|launch|load)/i] },
  { slug: "hardware_driver_specific", category: "performance", patterns: [/\bdriver\b/i, /\bnvidia\b/i, /\bamd\b/i, /\bintel arc\b/i, /\brtx\b/i, /\bgtx\b/i, /\bradeon\b/i] },
  { slug: "performance_regression", category: "performance", patterns: [/\bfps\b/i, /stutter/i, /frame ?(rate|pacing|drops?)/i, /performance/i, /\blag\b/i] },
  { slug: "controls_input_gameplay", category: "controls_gameplay", patterns: [/\bhorse\b/i, /\bmount\b/i, /\binput\b/i, /control/i, /lock(s|ed)? ?up/i, /unresponsive/i, /title screen/i] },
];

/**
 * Pick the watchlist cluster a signal belongs to.
 * Preference order: validated LLM assignment > keyword route (first match wins,
 * ordered most-specific first) > null (caller creates a new cluster).
 */
export function routeToWatchlistCluster(input: RoutingInput, clusters: RoutableCluster[]): RoutableCluster | null {
  const bySlug = new Map(clusters.map((cluster) => [cluster.slug, cluster]));

  if (input.llmClusterSlug) {
    const match = bySlug.get(input.llmClusterSlug);
    if (match) return match;
  }

  const text = `${input.issueTitle} ${input.summary}`;
  for (const route of KEYWORD_ROUTES) {
    if (route.category !== input.category) continue;
    if (!bySlug.has(route.slug)) continue;
    if (route.patterns.some((pattern) => pattern.test(text))) return bySlug.get(route.slug) ?? null;
  }
  return null;
}
```

**extract.ts changes:**
- `buildPrompt` gains an optional `clusterOptions: {slug: string; title: string}[]` parameter appended to the prompt when non-empty:
  `"Known issue clusters (assign clusterSlug if one matches, else null): " + clusterOptions.map(c => `${c.slug}: ${c.title}`).join(" | ")` plus instruction line `'Return clusterSlug as one of the listed slugs or null.'`
- `ExtractedSignal` gains `clusterSlug: string | null`.
- `parseOpenRouterExtraction(content, validSlugs: string[] = [])`: read `parsed.clusterSlug`; keep it only if it is a string included in `validSlugs`, else `null` (invalid slug is NOT an error — degrade to null).
- `deterministicExtract` sets `clusterSlug: null`.
- `extractSignalWithOpenRouter` gains `clusterOptions` in its options type, threads it to `buildPrompt` and `parseOpenRouterExtraction`.

**run.ts changes:**
- New loader:

```ts
type RoutableClusterRow = { id: string; slug: string; title: string; category: string };

async function loadRoutableClusters(supabase: ReturnType<typeof createServiceClient>): Promise<RoutableClusterRow[]> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category")
    .not("slug", "like", "auto-%");
  if (error) throw new Error(`routable clusters read failed: ${error.message}`);
  return (data ?? []) as RoutableClusterRow[];
}
```

- Load once in `runAutomationMonitor` before `prepareSignals` (works in dry_run too — it's a read); pass into `prepareSignals`, which passes `clusterOptions` (slug+title) into `extractSignalWithOpenRouter`.
- `resolveClusterId` order becomes: cached semantic → `findExistingSignalCluster` (unchanged) → **`routeToWatchlistCluster(...)` result** → `matchingReportCluster` (unchanged) → `createCluster`.
- Dry-run note: `prepareSignals` runs for dry runs too, so extraction gets cluster options in dry mode — fine, reads only.

- [ ] **Step 1: Write failing tests** in new `tests/automationRoute.test.ts`:
  - LLM slug wins: input `llmClusterSlug: "boss_rematch_crash_persistent"` → routes there even if keywords say otherwise
  - invalid LLM slug (not in cluster list) was already nulled by parser — test router with `llmClusterSlug: null` + title "game crashes when I open the map" + category crash_startup → `map_open_crash_persistent`
  - "boss rematch crashed again" + crash_startup → `boss_rematch_crash_persistent`
  - "fps drops since patch" + performance → `performance_regression`
  - "stutter on my RTX 4070 after driver update" + performance → `hardware_driver_specific` (specificity: hardware route listed before generic performance)
  - "horse controls unresponsive" + controls_gameplay → `controls_input_gameplay`
  - "weird audio buzzing" + category audio → null (no route)
  - category mismatch: "map crash" text but category performance → does NOT route to map cluster
- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/automationRoute.test.ts`
- [ ] **Step 3: Implement `route.ts`** per code above.
- [ ] **Step 4: Write failing parser tests** in `tests/automationLogic.test.ts`: `parseOpenRouterExtraction` with `clusterSlug: "performance_regression"` + `validSlugs: ["performance_regression"]` keeps it; with a slug not in validSlugs → null; missing clusterSlug field → null.
- [ ] **Step 5: Implement extract.ts changes.**
- [ ] **Step 6: Wire run.ts** (loader, threading, `resolveClusterId` order). Add/adjust a test in `tests/automationRun.test.ts`: a kept signal whose extraction routes to a seeded cluster upserts with that cluster's id (stub the clusters read to return a seeded cluster row; assert the `source_signals` upsert payload's `cluster_id`).
- [ ] **Step 7: Run all tests + lint + build.**
- [ ] **Step 8: Commit:** `feat(scanner): route signals into seeded watchlist clusters via LLM assignment + keyword fallback`

---

## Task 3: Promotion hardening — domain-distinct independence, no single-source publish

**Problem:** `shouldPromoteSignalCluster` treats two URLs from the same content farm as "two independent sources", and publishes on a single source if a free-tier LLM self-reports "high" confidence. These are the two paths by which a false claim goes public.

**Files:**
- Create: `src/lib/automation/domains.ts`
- Modify: `src/lib/automation/promote.ts`
- Modify: `src/lib/automation/run.ts` (`independentSourceCount` → domain-based; feed new fields)
- Modify: `tests/automationLogic.test.ts` or the promote tests wherever `shouldPromoteSignalCluster` is tested (search for it), plus `tests/automationRun.test.ts` if it asserts promotion reasons.

**Design — `src/lib/automation/domains.ts`:**

```ts
const TRUSTED_DOMAINS = new Set([
  "reddit.com",
  "steamcommunity.com",
  "pearlabyss.com",
  "crimsondesert.pearlabyss.com",
  "ign.com",
  "pcgamer.com",
  "rockpapershotgun.com",
  "eurogamer.net",
  "gamespot.com",
  "kotaku.com",
  "polygon.com",
  "vg247.com",
  "pushsquare.com",
  "purexbox.com",
  "dsogaming.com",
  "wccftech.com",
  "tomshardware.com",
]);

export type DomainTier = "trusted" | "unknown";

export function domainTier(domain: string | null): DomainTier {
  if (!domain) return "unknown";
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  if (TRUSTED_DOMAINS.has(normalized)) return "trusted";
  // subdomain of a trusted domain counts (old.reddit.com, forums.pearlabyss.com)
  for (const trusted of TRUSTED_DOMAINS) {
    if (normalized.endsWith(`.${trusted}`)) return "trusted";
  }
  return "unknown";
}
```

**promote.ts — new `PromotionInput` and rules:**

```ts
export type PromotionInput = {
  /** Count of distinct source domains observed in the last 14 days. */
  independentDomainCount: number;
  /** Of those domains, how many are tier "trusted". */
  trustedDomainCount: number;
  directReportCount: number;
  hasAdminForcePublic: boolean;
  hasAdminForceHidden: boolean;
};

export function shouldPromoteSignalCluster(input: PromotionInput): PromotionDecision {
  if (input.hasAdminForceHidden) return { publicStatus: "hidden", reason: "admin_force_hidden" };
  if (input.hasAdminForcePublic) return { publicStatus: "public", reason: "admin_force_public" };
  if (input.directReportCount > 0) return { publicStatus: "public", reason: "direct_report_match" };
  if (input.independentDomainCount >= 2 && input.trustedDomainCount >= 1) {
    return { publicStatus: "public", reason: "two_independent_domains_trusted" };
  }
  if (input.independentDomainCount >= 3) {
    return { publicStatus: "public", reason: "three_independent_domains" };
  }
  return { publicStatus: "private", reason: "below_threshold" };
}
```

Remove `highestConfidence` plumbing from run.ts's promotion call (the `CONFIDENCE_RANK`/`highestConfidence` helpers become unused — delete them). Also delete `hasClearCategory`/`hasClearPlatform` and their run.ts feeder helpers (`isClearCategory`, `isClearPlatform`, `signalPlatform`) if nothing else uses them — no dead parameters.

**run.ts — replace `independentSourceCount`:**

```ts
function signalDomain(row: SourceSignalRow): string | null {
  if (row.source_domain) return row.source_domain;
  if (!row.canonical_url) return null;
  try {
    return new URL(row.canonical_url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainCounts(rows: SourceSignalRow[], now: Date): { independentDomainCount: number; trustedDomainCount: number } {
  const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
  const domains = new Set(
    rows
      .filter((row) => isObservedWithinWindow(row, now, recentWindowMs))
      .map(signalDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  let trustedDomainCount = 0;
  for (const domain of domains) if (domainTier(domain) === "trusted") trustedDomainCount += 1;
  return { independentDomainCount: domains.size, trustedDomainCount };
}
```

- [ ] **Step 1: Find existing promote tests:** `grep -r "shouldPromoteSignalCluster" tests/` and rewrite them as failing tests for the new rules:
  - 2 signals same domain (2 URLs on `randomblog.example`) → private, `below_threshold`
  - reddit.com + `randomblog.example` → public, `two_independent_domains_trusted`
  - 3 unknown domains → public, `three_independent_domains`
  - 2 unknown domains → private
  - direct report → public regardless of domains
  - admin force hidden beats force public
  - `domainTier("old.reddit.com")` → trusted; `domainTier("evilreddit.com")` → unknown; `domainTier(null)` → unknown
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `domains.ts`, new `promote.ts`, run.ts changes. Delete dead helpers (`CONFIDENCE_RANK`, `highestConfidence`, old `independentSourceCount`) and unused imports.
- [ ] **Step 4: Update `tests/automationRun.test.ts`** for the new promotion input shape (whatever it stubs/asserts about promotion).
- [ ] **Step 5: Run all tests + lint + build.**
- [ ] **Step 6: Commit:** `feat(scanner): promotion requires independent domains with trust tier, drop single-source publish path`

---

## Task 4: Rejected-candidate queue + admin funnel UI + rescue

**Problem:** The admin can see skip-code counts but never WHICH candidates were rejected or why, so filters can't be tuned against reality. There is also no way to rescue a wrongly-rejected candidate.

**Files:**
- Create: `supabase/migrations/20260706110000_automation_rejected_candidates.sql`
- Modify: `src/lib/automation/run.ts` (record rejections in non-dry runs; return run id from ledger insert)
- Modify: `src/app/admin/actions.ts` (add `rescueRejectedCandidate` server action)
- Modify: `src/lib/queries.ts` (`getAutomationAdminData` returns rejected candidates + funnel)
- Modify: `src/app/admin/source-monitor/page.tsx` (funnel bar per run, rejected list with Rescue buttons)
- Modify: `tests/automationRun.test.ts`, `tests/adminActions.test.ts`

**Migration `20260706110000_automation_rejected_candidates.sql`:**

```sql
create table if not exists automation_rejected_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references automation_runs(id) on delete cascade,
  title text not null,
  url text not null,
  source_domain text,
  snippet text,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  rescued_at timestamptz
);

create index if not exists idx_rejected_candidates_created on automation_rejected_candidates (created_at desc);

alter table automation_rejected_candidates enable row level security;
```

(Service role bypasses RLS; no policies needed — matches `automation_runs` precedent.)

**run.ts changes:**
- `prepareSignals` collects rejects: on pre-screen or post-extraction rejection, push `{title, url: canonicalUrl, sourceDomain, snippet: signal.body.slice(0, 500), reason}` into a `rejected: RejectedCandidate[]` array on the result flow (add `rejectedCandidates: RejectedCandidate[]` to what `prepareSignals` returns — change its return type to `{ prepared: PreparedSignal[]; rejected: RejectedCandidate[] }`).
- In `runAutomationMonitor`, for modes other than `dry_run`, after `persistSignals`, insert up to 50 rejected candidates (single `.insert(rows)` call, error → `result.errors.push`, status partial, not fatal), and delete expired rows: `.delete().lt("expires_at", now.toISOString())` (ignore error into `result.errors` as non-fatal too). Dry runs keep their "writes only the ledger row" promise — do not persist rejects in dry mode.
- `insertRunLedger`: change to `.insert({...}).select("id").single()` and pass the returned id into the rejected-candidates insert (`run_id`). Ledger insert happens at the END currently — restructure: insert the ledger row first with the final result? No — keep it simple: insert rejected candidates AFTER `insertRunLedger`, so make `insertRunLedger` return the run id and move the rejected insert after it. Update the function's callers accordingly (there are early-return paths — only the main path needs rejects).

**Rescue action in `src/app/admin/actions.ts`:**

```ts
export async function rescueRejectedCandidate(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("bad input");
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_rejected_candidates")
    .select("id, title, url, source_domain, snippet")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`rejected candidate read failed: ${error.message}`);
  const candidate = (data ?? [])[0];
  if (!candidate) throw new Error("rejected candidate not found");

  await rescueCandidateSignal(supabase, {
    title: candidate.title,
    url: candidate.url,
    sourceDomain: candidate.source_domain ?? null,
    snippet: candidate.snippet ?? "",
  });

  const { error: markError } = await supabase
    .from("automation_rejected_candidates")
    .update({ rescued_at: new Date().toISOString() })
    .eq("id", id);
  if (markError) throw new Error(`rescue mark failed: ${markError.message}`);

  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}
```

**`rescueCandidateSignal`** is a new export from `src/lib/automation/run.ts`: builds a `SourceInput` (`source: "web_search"`, `id: url`, `observedAt: now`), canonicalizes, extracts via `extractSignalWithOpenRouter` with `llmCallsRemaining: 1` and cluster options loaded via `loadRoutableClusters`, SKIPS all relevance gates (that's the point of rescue), then reuses the existing `resolveClusterId` + `upsertSignal` + `refreshClusterStats` path (load reports/excerpts as `persistSignals` does). Extract the shared persist-one-signal logic rather than duplicating it.

**Admin UI (`source-monitor/page.tsx`):**
- Per run card, render funnel as a compact line when `run.funnel` has data: `“{candidatesSeen} seen → {deduped} deduped → {prefilterRejected} pre-filtered → {llmCalls} LLM → {kept} kept → {promoted} promoted”` styled `text-xs`, `var(--text-dim)`. (Add `funnel` to the run select in `getAutomationAdminData` and to `AutomationRunRow` as `funnel: Record<string, number> | null`.)
- New panel "Rejected candidates (last 7 days)" below Recent signals: for each — reason chip (`chip` class), title, domain, observed date, link to URL, and a Rescue form/button (`btn btn-ghost btn-sm`, `SubmitButton` with `pendingText="Rescuing…"`), hidden input id. Rows with `rescued_at` show a `badge badge-green` "rescued" instead of the button. Query in `getAutomationAdminData`: select last 30 by `created_at desc` where `expires_at > now`.

- [ ] **Step 1: Migration file.**
- [ ] **Step 2: Failing tests in `tests/automationRun.test.ts`:** non-dry run inserts rejected candidates rows with `run_id` set (stub supabase captures inserts to `automation_rejected_candidates`); dry run inserts none; expired-delete call issued.
- [ ] **Step 3: Implement run.ts changes** (return-shape change, ledger returns id, rejected insert + cleanup, `rescueCandidateSignal` export).
- [ ] **Step 4: Failing test in `tests/adminActions.test.ts`** following that file's existing stub pattern: `rescueRejectedCandidate` reads the row, persists a signal (upsert to `source_signals` observed), marks `rescued_at`.
- [ ] **Step 5: Implement the action + queries + UI.**
- [ ] **Step 6: All tests + lint + build.**
- [ ] **Step 7: Commit:** `feat(admin): per-run funnel readout, rejected-candidate queue with rescue`

---

## Task 5: Official patch-note claimed-fix checklist

**Problem:** With zero users the site has nothing real to show. The one fully-verifiable, zero-user asset is Pearl Abyss's own patch notes: extract each claimed fix and show a public checklist with an honest evidence state. It also grounds the two `fix_claimed` watchlist clusters.

**Files:**
- Modify: `src/lib/officialPatch.ts` (`parseClaimedFixes`, include in `OfficialPatchNote`)
- Modify: `src/lib/officialPatch.server.ts` (persist claimed fixes on sync; read API)
- Create: `supabase/migrations/20260706120000_patch_claimed_fixes.sql`
- Modify: `src/lib/queries.ts` (dashboard data gains `claimedFixes`)
- Modify: `src/app/page.tsx` (render checklist panel)
- Modify: existing officialPatch tests (find with `grep -rl "parseOfficialPatchDetail" tests/`), plus `tests/queries.test.ts` if it snapshots dashboard shape.

**Migration `20260706120000_patch_claimed_fixes.sql`:**

```sql
create table if not exists official_patch_claimed_fixes (
  id uuid primary key default gen_random_uuid(),
  board_no text not null,
  position integer not null,
  fix_text text not null,
  category text,
  created_at timestamptz not null default now(),
  unique (board_no, position)
);

alter table official_patch_claimed_fixes enable row level security;
```

**`parseClaimedFixes(html: string): string[]`** in officialPatch.ts (pure, exported):

```ts
const FIX_LANGUAGE = /\b(fixed|resolved|addressed|corrected|no longer)\b/i;

export function parseClaimedFixes(html: string): string[] {
  const fixes: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = decodeHtml((match[1] ?? "").replace(/<[^>]*>/g, ""));
    if (!text || text.length < 12 || text.length > 300) continue;
    if (!FIX_LANGUAGE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fixes.push(text);
    if (fixes.length >= 30) break;
  }
  return fixes;
}
```

`OfficialPatchNote` gains `claimedFixes: string[]`; `parseOfficialPatchDetail` populates it; `parseOfficialNoticeList` result (the base) is unaffected.

**officialPatch.server.ts:**
- `syncOfficialPatchNote`: after the patch upsert, delete existing rows for `board_no` then insert claimed fixes rows `{board_no, position: index, fix_text, category: classifySignal(fix_text).category === "other" ? null : classifySignal(...).category}` (import `classifySignal` from `@/lib/reddit`; call once per fix). Non-fatal? No — throw on error like the other writes.
- New export `getClaimedFixesForCurrentPatch(supabase): Promise<{fixText: string; category: string | null}[]>` — join via the current patch's board_no: read current patch row's board_no (reuse `readCurrentPatchUncached`? it doesn't return board_no — extend the row read to include board_no in `OfficialPatchRow`/select; add `boardNo` to `CurrentPatchMetadata`? NO — keep `CurrentPatchMetadata` stable; write a dedicated query: select board_no of `is_current` row, then select fixes ordered by position). Return `[]` on any error (public page must not 500 over this).

**queries.ts / page.tsx:**
- `getDashboardDataUncached` adds `claimedFixes: await getClaimedFixesForCurrentPatch(supabase)` (and `[]` in the no-config early return).
- Dashboard: new panel "What patch {version} claims to fix" placed directly under Headline stats. Each fix: a row with the fix text and a status chip: if the fix routes (by the Task 2 `KEYWORD_ROUTES`-style matching — reuse `routeToWatchlistCluster` with the fix text as issueTitle+summary and its stored category, against the top clusters list) to a cluster with evidence (`strengthScore > 0`) → `badge badge-crimson` "contradicted by evidence"; else `badge badge-dim` "no contradicting evidence". Footer note (`text-xs`, faint): "Sourced from Pearl Abyss's official patch notes. 'No contradicting evidence' means no approved reports or corroborated public signals dispute this fix yet." If `claimedFixes` empty, omit the panel entirely (no empty shell).
- Import note: `routeToWatchlistCluster` needs `category` as `Category` — stored category may be null; when null, skip routing and use the dim chip.

- [ ] **Step 1: Failing tests for `parseClaimedFixes`** (add near existing officialPatch parse tests): HTML fixture with `<li>Fixed an issue where the map crashed the game.</li><li>Improved lighting.</li><li>Fixed the map crash.</li>` → returns only the two "Fixed…" items? NO — "Fixed the map crash." (12+ chars, distinct text) also passes; assert exact expected array `["Fixed an issue where the map crashed the game.", "Fixed the map crash."]` (dedupe is by full lowercased text; "Improved lighting." fails FIX_LANGUAGE). Also: `<li>` shorter than 12 chars dropped; >300 chars dropped; nested tags stripped.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement officialPatch.ts changes** (existing `parseOfficialPatchDetail` tests must be updated for the new `claimedFixes` field).
- [ ] **Step 4: Failing test for sync persistence** (extend whatever test covers `syncOfficialPatchNote` — grep tests for it): fake supabase captures delete+insert on `official_patch_claimed_fixes` with positions 0..n.
- [ ] **Step 5: Implement server sync + `getClaimedFixesForCurrentPatch` + migration.**
- [ ] **Step 6: Wire queries.ts + dashboard panel.**
- [ ] **Step 7: All tests + lint + build.**
- [ ] **Step 8: Commit:** `feat(patch): extract official claimed fixes into public checklist with evidence status`

---

## Task 6: Public evidence ladder + scanner heartbeat (kill the dead-site zeros)

**Problem:** The public pages lead with 0/0/0 stat cards and a scanner line reading "success · 0 searches, 0 candidate signals" — the site reads as abandoned rather than vigilant. There is no per-cluster state; six cards repeat the same disclaimer sentence.

**Files:**
- Create: `src/lib/evidenceLadder.ts` + `tests/evidenceLadder.test.ts`
- Modify: `src/lib/queries.ts` (candidate counts per cluster; latest scan metadata incl. `search_results_seen`, `finished_at`)
- Modify: `src/components/ui.tsx` (add `EvidenceLadderBadge`)
- Modify: `src/app/issues/page.tsx`, `src/app/page.tsx`
- Modify: `tests/queries.test.ts` if shapes are asserted there

**`src/lib/evidenceLadder.ts`:**

```ts
export type EvidenceLadderState = "watching" | "candidates" | "corroborated" | "player_confirmed";

export type LadderInput = {
  directReportCount: number;
  publicSignalCount: number;
  candidateSignalCount: number;
};

export function clusterEvidenceState(input: LadderInput): EvidenceLadderState {
  if (input.directReportCount > 0) return "player_confirmed";
  if (input.publicSignalCount > 0) return "corroborated";
  if (input.candidateSignalCount > 0) return "candidates";
  return "watching";
}

export const LADDER_LABELS: Record<EvidenceLadderState, string> = {
  watching: "Watching",
  candidates: "Candidates under review",
  corroborated: "Corroborated",
  player_confirmed: "Player-confirmed",
};

export const LADDER_DESCRIPTIONS: Record<EvidenceLadderState, string> = {
  watching: "The scanner checks public sources for this on every run. Nothing found yet.",
  candidates: "The scanner found mentions that have not passed the independence threshold. Counts only — content stays private until corroborated.",
  corroborated: "Multiple independent public sources describe this issue. Sources are linked below.",
  player_confirmed: "Approved player reports confirm this issue.",
};
```

**queries.ts:**
- Issues + dashboard queries add a private-signal count per cluster: one extra select `from("source_signals").select("cluster_id").eq("public_status", "private")` → `countBy` → `candidateSignalCount` merged onto each cluster object (0 default). ONLY counts — never select private summaries/urls for public pages.
- Dashboard `latestAutomationRun` select adds `search_results_seen, finished_at` (extend `PublicAutomationRunRow`).

**ui.tsx — `EvidenceLadderBadge({state}: {state: EvidenceLadderState})`:** renders `badge` with tone: watching → `badge-dim`, candidates → `badge-blue`, corroborated → `badge-amber`, player_confirmed → `badge-green`, text from `LADDER_LABELS`, `title` attr from `LADDER_DESCRIPTIONS` (hover explanation).

**issues/page.tsx:**
- Each `ClusterCard` computes `state = clusterEvidenceState(...)` and renders `EvidenceLadderBadge` in the badge row (replacing `ConfidenceBadge` for seed clusters — keep `FixStatusBadge`).
- When state is `candidates`: a line `“{candidateSignalCount} candidate signal(s) under review — not yet independent enough to publish.”` (`text-xs`, dim).
- The empty-state footer sentence becomes the heartbeat: `“○ Watching · scanner last finished {timeAgo} · Seeing this on {currentPatch.version}?”` — pass latest run `finished_at` into the page (add a lightweight fetch: reuse `getDashboardData`? No — add `getLatestPublicScanMeta()` export in queries.ts selecting the latest non-dry run's `finished_at, status, search_results_seen`; call it from the issues page alongside existing fetches).
- The three top stat cards get honest notes instead of naked zeros: "With evidence" card note when 0: "scanner active — nothing corroborated yet".

**page.tsx (dashboard):**
- Scanner panel line replaced: when latest run exists — `“Last scan finished {timeAgo} · {status} · {search_results_seen} sources reviewed · {signals_inserted} kept as candidates”`. When `search_queries_used === 0`, append `“ · search skipped this run”`. (This kills the "0 searches · success" contradiction.)
- Stat cards: "Community signals" note when 0 becomes `“{totalCandidates} candidate(s) under review”` (sum of candidateSignalCount across clusters; when that's also 0: "none found yet — scanner active"). "Total reports" note when 0: "be the first — takes 60 seconds" (link styling not needed, plain note).
- Watchlist card grid items each show `EvidenceLadderBadge` instead of `ConfidenceBadge`.

- [ ] **Step 1: Failing tests `tests/evidenceLadder.test.ts`:** each state boundary (0/0/0 → watching; candidates only → candidates; public signal → corroborated even with candidates; direct report → player_confirmed even with signals).
- [ ] **Step 2: Run to verify failure; implement `evidenceLadder.ts`.**
- [ ] **Step 3: queries.ts additions** (+ update `tests/queries.test.ts` for new fields if it breaks).
- [ ] **Step 4: UI wiring** (ui.tsx badge, issues page, dashboard). Keep copy EXACTLY as specified above.
- [ ] **Step 5: All tests + lint + build.**
- [ ] **Step 6: Commit:** `feat(public): evidence ladder states, candidate counts, scanner heartbeat replaces dead zeros`

---

## Task 7: Evidence Assistant how-to + preview-before-insert

**Problem:** The assistant silently mutates form fields after file selection, gives no guidance on which files to pick or where they live, and never shows the user what will be sent before it lands in the form. Owner dogfooding verdict: "no idea how it 1) works 2) is it safe 3) what files to get."

**Files:**
- Modify: `src/app/report/ReportForm.tsx`
- Modify: `src/lib/saveImport.ts` only if a new pure helper is needed (avoid if possible)
- Tests: `tests/saveImport.test.ts` untouched unless helper added; UI verified via lint + build.

**Design — three changes inside the Evidence assistant panel:**

1. **How-to (always visible, above the file input).** Replace the current single paragraph with a numbered mini-list (`text-sm`, dim, `space-y-1`):
   - `1. Pick your settings/log files — on PC look in Documents\Crimson Desert\ (the settings file is user_engine_option_save.xml). Console players: skip this, it's PC-only.`
   - `2. Your browser reads them locally and drafts one short note (GPU settings, file names — no personal data).`
   - `3. You preview the note before it touches your report. Nothing uploads until you press Submit, and only the note is sent.`

2. **Preview-before-insert.** `onSaveImport` currently writes `graphicsModeRef`/`troubleshootingRef` immediately. Change to: run analysis, store it in state as a *pending* preview (`const [pendingImport, setPendingImport] = useState<SaveImportAnalysis | null>(null)`), and render a preview block:
   - Label: `stat-label` "Preview — nothing added yet"
   - The `evidenceNote` text and (if present) `graphicsMode` line, each in a bordered `panel-inset` box, `text-xs`.
   - Two buttons: `Add to report` (`btn btn-sm`, type="button") and `Discard` (`btn btn-ghost btn-sm`, type="button").
   - `Add to report` performs exactly the ref-writing logic that currently runs inline (graphics mode fill-if-empty; troubleshooting append-if-absent), then moves `pendingImport` → `saveImport` (applied state) and shows the existing applied summary. `Discard` clears pending state and resets the file input value.
3. **Applied state:** after Add, show the existing privacy/evidence note block plus a small `badge badge-green` "added to Troubleshooting field". Keep `aria-live="polite"` on status messages.

Constraints:
- No new dependencies. No layout framework changes. Keep the panel in the same aside position.
- The existing behavior "reads only small XML/log/text files, max 18" text stays.
- TypeScript strict — the refs and handlers already exist; reuse them.

- [ ] **Step 1: Implement the ReportForm changes** per design (this is UI-only; no unit test infra for components — rely on types + lint + build).
- [ ] **Step 2: `npx vitest run && npm run lint && npm run build` all green.**
- [ ] **Step 3: Commit:** `feat(report): evidence assistant how-to, preview-before-insert, explicit apply/discard`

---

## Final integration checks (after all tasks)

- [ ] `npx vitest run` — full suite green.
- [ ] `npm run lint && npm run build` — green.
- [ ] `grep -rn "shouldKeepAutomatedSignal\|single_high_confidence_source\|independentSourceCount" src/ tests/` — zero hits (fully removed).
- [ ] Dispatch final code review of the whole branch diff.
