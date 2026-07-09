# Dashboard Rescue Implementation Plan

> **HISTORICAL / SUPERSEDED (2026-07-09). DO NOT EXECUTE.** The owner-approved [Confirmation Board design](../specs/2026-07-09-confirmation-board-design.md) and its [implementation record](2026-07-09-confirmation-board.md) replace this plan wherever they differ. In particular, Reddit API activation, a `$5/month` posture, claims-as-verdict UI, and unconditional production-migration follow-ups are obsolete. The unchecked boxes below preserve the original plan; they are not an active backlog.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the patch-claims wall with a claims-vs-evidence scoreboard, compact the Issues-page watchlist, run scans in the background with live funnel progress, make the daily cron trustworthy (dry runs never suppress it; skipped attempts leave a ledger trace), and retry flaky free-LLM extractions.

**Architecture:** Next.js 16 App Router + Supabase (service client, RLS-locked tables). Scanner logic is pure-ish functions in `src/lib/automation/*` orchestrated by `run.ts`. Background work uses `after()` from `next/server` (built into Next 16 — do NOT add `@vercel/functions`). Tests are Vitest in `tests/*.test.ts`; UI is verified by `npm run lint` + `npm run build` (no component test infra). DB changes are SQL files in `supabase/migrations/` named `YYYYMMDDHHMMSS_name.sql`.

**Tech Stack:** TypeScript, Next.js 16.2.10, React 19, Supabase JS, Vitest, custom CSS utility classes from `src/app/globals.css` (`panel`, `panel-inset`, `badge badge-*`, `stat-label`, `stat-value`, `num`, `btn`, `chip` — reuse them, never invent new CSS).

**Conventions that MUST be followed:**
- Run tests with `npx vitest run` (all) or `npx vitest run tests/<file>.test.ts`.
- `npm run lint` and `npm run build` must pass before each commit.
- Server-only modules import `"server-only"`. Pure-logic modules (testable) must NOT import `"server-only"`. `tests/server-only-stub.ts` is aliased by vitest, so importing server modules in tests works, but prefer pure modules for logic.
- Supabase reads/writes: always check `error` and throw `` new Error(`<label> failed: ${error.message}`) `` — except best-effort writes explicitly marked below (wrap in try/catch and swallow).
- Styling: inline `style={{ color: "var(--text-dim)" }}` pattern and existing badge classes. Mono numbers get the `num` class.
- Commit after each task with a conventional message. Never commit `docs/superpowers/plans/` changes in feature commits.
- The production DB migration is applied by the ORCHESTRATOR via Supabase MCP, not by task subagents. Subagents only create the SQL file. Vercel preview deployments share the production database (reads fine; `previewGuard` blocks writes).

**Current-state facts workers need:**
- `automation_runs` already has `status` check `('running','success','partial','failed','skipped')`, nullable `finished_at`, `funnel jsonb`, `skips jsonb`, `errors jsonb`. It does NOT have `progress`.
- `runAutomationMonitor` currently inserts the ledger row only at the END of a run (`insertRunLedger`).
- The scan buttons are server actions (`runAutomationDryScan`, `runAutomationCappedScan` in `src/app/admin/actions.ts`) — in-flight server actions block all router navigation in the tab; that is the bug being fixed.
- The keepalive cron (`src/app/api/cron/keepalive/route.ts`) skips automation when ANY `automation_runs` row (including dry runs) started in the last 6 hours, and writes no trace when it skips.
- `ExtractionResult.llmCallUsed` is a boolean today; Task 2 changes it to a count (`llmCallsUsed: number`). `run.ts` and tests reference the boolean — grep for `llmCallUsed` and update every site.

---

## Task 1: Run lifecycle — create at start, finalize at end, live progress, stale sweep

**Files:**
- Create: `supabase/migrations/20260706150000_automation_run_progress.sql`
- Modify: `src/lib/automation/run.ts`
- Test: `tests/automationRun.test.ts` (extend, follow its existing supabase-mock patterns)

- [ ] **Step 1: Write the migration file** (do NOT apply it — orchestrator applies it)

```sql
alter table automation_runs
  add column if not exists progress jsonb;
```

- [ ] **Step 2: Add progress types + ledger lifecycle to `src/lib/automation/run.ts`**

Add near the top (after `AutomationResult`):

```ts
export type RunProgress = {
  stage: "starting" | "searching" | "screening" | "persisting" | "done";
  searchesDone: number;
  searchTotal: number;
  candidatesSeen: number;
  prefilterRejected: number;
  llmCallsUsed: number;
  kept: number;
  promoted: number;
};

function snapshotProgress(stage: RunProgress["stage"], result: AutomationResult, searchTotal: number): RunProgress {
  return {
    stage,
    searchesDone: result.searchQueriesUsed,
    searchTotal,
    candidatesSeen: result.candidatesSeen,
    prefilterRejected: result.prefilterRejected,
    llmCallsUsed: result.llmCallsUsed,
    kept: result.signalsInserted,
    promoted: result.clustersPromoted,
  };
}

/** Best-effort progress write — never throws, never fails a run. */
async function writeProgress(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  progress: RunProgress,
): Promise<void> {
  try {
    await supabase.from("automation_runs").update({ progress }).eq("id", runId);
  } catch {
    // best-effort by design
  }
}

const STALE_RUN_MINUTES = 15;

/** Finalize crashed runs: a killed serverless function can never finalize its own row. */
export async function sweepStaleRuns(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<void> {
  try {
    await supabase
      .from("automation_runs")
      .update({
        status: "failed",
        finished_at: now.toISOString(),
        errors: ["stale_running_run"],
      })
      .eq("status", "running")
      .lt("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString());
  } catch {
    // best-effort by design
  }
}

export async function hasActiveRun(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString())
    .limit(1);
  if (error) throw new Error(`active run read failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).length > 0;
}
```

- [ ] **Step 3: Replace `insertRunLedger` with create/finalize pair**

Delete `insertRunLedger` and add:

```ts
async function createRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  mode: AutomationMode,
  budget: AutomationBudget,
  now: Date,
): Promise<string> {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      started_at: now.toISOString(),
      status: "running",
      mode,
      budget_monthly_usd: budget.monthlyBudgetUsd,
      budget_remaining_before_usd: budget.remainingMonthUsd,
      progress: {
        stage: "starting",
        searchesDone: 0,
        searchTotal: budget.maxSearchQueries,
        candidatesSeen: 0,
        prefilterRejected: 0,
        llmCallsUsed: 0,
        kept: 0,
        promoted: 0,
      } satisfies RunProgress,
    })
    .select("id")
    .single();
  if (error) throw new Error(`automation run create failed: ${error.message}`);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("automation run create returned no id");
  return id;
}

async function finalizeRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  result: AutomationResult,
): Promise<void> {
  const { error } = await supabase
    .from("automation_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: result.errors.length > 0 && result.status === "success" ? "partial" : result.status,
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
      funnel: {
        candidatesSeen: result.candidatesSeen,
        deduped: result.signalsDeduped,
        prefilterRejected: result.prefilterRejected,
        llmCalls: result.llmCallsUsed,
        kept: result.signalsInserted,
        promoted: result.clustersPromoted,
      },
      progress: snapshotProgress("done", result, result.searchQueriesUsed),
    })
    .eq("id", runId);
  if (error) throw new Error(`automation run finalize failed: ${error.message}`);
}
```

- [ ] **Step 4: Split `runAutomationMonitor` into `startAutomationScan` + internal executor**

Replace the body of `runAutomationMonitor` with this structure (keep the existing budget/patch/collect/prepare/persist logic inside `executeAutomationRun` — this is a re-arrangement, not a rewrite):

```ts
export type StartedScan =
  | { status: "started"; runId: string; completion: Promise<AutomationResult> }
  | { status: "already_running"; runId: null };

export async function startAutomationScan(input: { mode: AutomationMode; now?: Date }): Promise<StartedScan> {
  const now = input.now ?? new Date();
  const supabase = createServiceClient();
  await sweepStaleRuns(supabase, now);
  if (await hasActiveRun(supabase, now)) return { status: "already_running", runId: null };

  const monthlyBudgetUsd = automationBudgetUsd();
  let budgetReadError: string | null = null;
  let spentMonthToDateUsd = 0;
  try {
    spentMonthToDateUsd = await loadMonthSpend(supabase, now);
  } catch (error) {
    budgetReadError = toErrorMessage(error, "automation spend read failed");
    spentMonthToDateUsd = monthlyBudgetUsd;
  }
  const budget = computeAutomationBudget({ monthlyBudgetUsd, spentMonthToDateUsd, now });

  const runId = await createRunLedger(supabase, input.mode, budget, now);
  const completion = executeAutomationRun(supabase, runId, input.mode, budget, budgetReadError, now);
  return { status: "started", runId, completion };
}

/** Awaits the whole scan inline — used by the cron and tests. */
export async function runAutomationMonitor(input: { mode: AutomationMode; now?: Date }): Promise<AutomationResult> {
  const started = await startAutomationScan(input);
  if (started.status === "already_running") {
    return {
      status: "skipped",
      redditPostsSeen: 0, searchQueriesUsed: 0, searchResultsSeen: 0, llmCallsUsed: 0,
      candidatesSeen: 0, prefilterRejected: 0, signalsInserted: 0, signalsDeduped: 0,
      clustersPromoted: 0, estimatedCostUsd: 0, skips: ["scan_already_running"], errors: [],
    };
  }
  return started.completion;
}
```

`executeAutomationRun(supabase, runId, mode, budget, budgetReadError, now)` contains the existing pipeline body with these changes:
- It initializes `result` exactly as before (including `skips: [...budget.skipReasons]`).
- The `budgetReadError` branch sets `status: "skipped"`, pushes `budget_read_failed` + the error, then calls `finalizeRunLedger` and returns — no `insertRunLedger`.
- Define `const report = (stage: RunProgress["stage"]) => writeProgress(supabase, runId, snapshotProgress(stage, result, budget.maxSearchQueries));`
- Call `await report("searching")` once before `collectInputs` and pass `report` into `collectInputs`; inside the web-search loop call `await report("searching")` after each `tavilySearch`.
- Pass `report` into `prepareSignals`; inside its candidate loop call `await report("screening")` after each candidate is processed (kept OR rejected).
- Call `await report("persisting")` just before `persistSignals`.
- Wrap the whole pipeline body in `try { ... } catch (error) { result.status = "failed"; result.errors.push(toErrorMessage(error, "automation run crashed")); }` then ALWAYS `await finalizeRunLedger(supabase, runId, result)` followed by the existing `persistRejectedCandidates(supabase, runId, rejected, result)` / `deleteExpiredRejectedCandidates` calls (non-dry-run only, and note `persistRejectedCandidates` now runs after finalize — its error pushes arrive too late for the ledger, so move those two calls BEFORE `finalizeRunLedger` instead, using `runId`).
- `collectInputs` and `prepareSignals` each gain a last optional parameter `report?: () => Promise<void>` (call sites shown above; inside them call `await report?.()` at the described points — adjust the signature so the stage is fixed at the call site as described).

- [ ] **Step 5: Extend `tests/automationRun.test.ts`**

Follow the file's existing mock style (it mocks `createServiceClient` and collaborator modules). Add tests asserting:
1. A successful run inserts a `status: "running"` row first, then updates the same id to a terminal status with `finished_at` set.
2. `sweepStaleRuns` issues an update with `status: "failed"` filtered by `status = running` and `started_at <` (15 minutes).
3. `startAutomationScan` returns `already_running` when `hasActiveRun` sees a running row (mock the select chain to return one row).
4. Progress updates: at least one `update` call carries `progress.stage === "screening"` during a run with candidates.

- [ ] **Step 6: Run tests, lint, build**

Run: `npx vitest run tests/automationRun.test.ts` → PASS; `npm run lint` → clean; `npm run build` → success.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260706150000_automation_run_progress.sql src/lib/automation/run.ts tests/automationRun.test.ts
git commit -m "feat: run ledger lifecycle with live progress and stale-run sweep"
```

---

## Task 2: Extraction retry for flaky free models

**Files:**
- Modify: `src/lib/automation/extract.ts`
- Modify: `src/lib/automation/run.ts` (llm call counting)
- Test: extend the existing extract tests (grep `extractSignalWithOpenRouter` under `tests/` to find the file — likely `tests/automationLogic.test.ts`)

- [ ] **Step 1: Change `llmCallUsed: boolean` to `llmCallsUsed: number` on `ExtractionResult`**

In `extract.ts`: `ExtractionResult` becomes `ExtractedSignal & { extractionProvider; extractionModel; llmCallsUsed: number; fallbackReason?: ... }`. `deterministicResult` takes `llmCallsUsed = 0` as its third param instead of `llmCallUsed = false`.

Grep the repo for `llmCallUsed` and update every site. In `run.ts` `prepareSignals`: `if (extraction.llmCallUsed) result.llmCallsUsed += 1;` becomes `result.llmCallsUsed += extraction.llmCallsUsed;`.

- [ ] **Step 2: Add the retry loop**

Restructure `extractSignalWithOpenRouter` so the fetch+parse attempt is a helper, and the exported function retries once on transient failures when allowance permits:

```ts
type AttemptOutcome =
  | { ok: true; signal: ExtractedSignal }
  | { ok: false; reason: "openrouter_provider_failure" | "openrouter_invalid_json" };

async function attemptOpenRouterExtraction(
  candidate: SourceCandidate,
  fetcher: OpenRouterFetch,
  apiKey: string,
  model: string,
  clusterOptions: ClusterOption[],
): Promise<AttemptOutcome> {
  let response: OpenRouterFetchResponse;
  try {
    response = await fetcher(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You extract game issue reports and return only valid JSON." },
          { role: "user", content: buildPrompt(candidate, clusterOptions) },
        ],
      }),
    });
  } catch {
    return { ok: false, reason: "openrouter_provider_failure" };
  }
  if (!response.ok) return { ok: false, reason: "openrouter_provider_failure" };
  try {
    const content = readOpenRouterContent(await response.json());
    if (!content) return { ok: false, reason: "openrouter_invalid_json" };
    const validSlugs = clusterOptions.map((option) => option.slug);
    return { ok: true, signal: parseOpenRouterExtraction(content, validSlugs) };
  } catch {
    return { ok: false, reason: "openrouter_invalid_json" };
  }
}
```

The exported function's tail becomes:

```ts
  const fetcher = options.fetcher ?? (fetch as unknown as OpenRouterFetch);
  const clusterOptions = options.clusterOptions ?? [];
  const maxAttempts = Math.min(2, Math.max(1, options.llmCallsRemaining));
  let callsUsed = 0;
  let lastReason: "openrouter_provider_failure" | "openrouter_invalid_json" = "openrouter_provider_failure";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    callsUsed += 1;
    const outcome = await attemptOpenRouterExtraction(candidate, fetcher, apiKey, model, clusterOptions);
    if (outcome.ok) {
      return { ...outcome.signal, extractionProvider: "openrouter", extractionModel: model, llmCallsUsed: callsUsed };
    }
    lastReason = outcome.reason;
  }
  return deterministicResult(candidate, lastReason, callsUsed);
```

- [ ] **Step 3: Extend the extract tests**

Using the existing fake-fetcher pattern in the test file:
1. Fetcher fails once (invalid JSON) then succeeds → provider result, `llmCallsUsed === 2`, no `fallbackReason`.
2. Fetcher fails twice → deterministic result, `fallbackReason: "openrouter_invalid_json"` (or provider_failure per the failure injected), `llmCallsUsed === 2`.
3. `llmCallsRemaining: 1` + first attempt fails → deterministic, `llmCallsUsed === 1` (no retry beyond allowance).
4. Existing tests updated from `llmCallUsed: true/false` to counts.

- [ ] **Step 4: Run tests, lint, build; commit**

Run: `npx vitest run` → PASS; `npm run lint`; `npm run build`.

```bash
git add src/lib/automation/extract.ts src/lib/automation/run.ts tests/
git commit -m "feat: retry flaky OpenRouter extractions once within LLM allowance"
```

---

## Task 3: Cron trust — dry runs never suppress, skips leave a trace

**Files:**
- Create: `src/lib/automation/schedule.ts` (pure, testable)
- Create: `tests/automationSchedule.test.ts`
- Modify: `src/app/api/cron/keepalive/route.ts`
- Modify: `src/lib/automation/run.ts` (skip-marker helper)
- Modify: `src/lib/queries.ts` (latest-run queries must ignore `skipped`/`running` rows)

- [ ] **Step 1: Write failing tests `tests/automationSchedule.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { blocksScheduledScan, nextScheduledScanAt, scheduledScanDecision } from "@/lib/automation/schedule";

describe("blocksScheduledScan", () => {
  it("counts real scheduled and manual runs", () => {
    expect(blocksScheduledScan({ mode: "scheduled", status: "success" })).toBe(true);
    expect(blocksScheduledScan({ mode: "manual", status: "running" })).toBe(true);
  });
  it("ignores dry runs and skip markers", () => {
    expect(blocksScheduledScan({ mode: "dry_run", status: "success" })).toBe(false);
    expect(blocksScheduledScan({ mode: "scheduled", status: "skipped" })).toBe(false);
  });
});

describe("scheduledScanDecision", () => {
  it("skips when paused", () => {
    expect(scheduledScanDecision(true, [])).toEqual({ run: false, skipReason: "paused" });
  });
  it("skips when a real run is recent", () => {
    expect(scheduledScanDecision(false, [{ mode: "manual", status: "success" }])).toEqual({
      run: false,
      skipReason: "recent_run",
    });
  });
  it("runs when only dry runs are recent", () => {
    expect(scheduledScanDecision(false, [{ mode: "dry_run", status: "success" }])).toEqual({ run: true });
  });
});

describe("nextScheduledScanAt", () => {
  it("returns today 09:00 UTC when before 09:00", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T05:00:00Z")).toISOString()).toBe("2026-07-06T09:00:00.000Z");
  });
  it("returns tomorrow 09:00 UTC when after 09:00", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T14:00:00Z")).toISOString()).toBe("2026-07-07T09:00:00.000Z");
  });
});
```

Run: `npx vitest run tests/automationSchedule.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/automation/schedule.ts`**

```ts
export type RecentRunLike = { mode: string; status: string };

export type ScheduledScanDecision = { run: true } | { run: false; skipReason: "paused" | "recent_run" };

/** Dry runs preview only and skip markers are bookkeeping — neither blocks the daily scan. */
export function blocksScheduledScan(run: RecentRunLike): boolean {
  return (run.mode === "scheduled" || run.mode === "manual") && run.status !== "skipped";
}

export function scheduledScanDecision(paused: boolean, recentRuns: RecentRunLike[]): ScheduledScanDecision {
  if (paused) return { run: false, skipReason: "paused" };
  if (recentRuns.some(blocksScheduledScan)) return { run: false, skipReason: "recent_run" };
  return { run: true };
}

const SCHEDULED_SCAN_UTC_HOUR = 9;

export function nextScheduledScanAt(now: Date): Date {
  const todayAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULED_SCAN_UTC_HOUR));
  if (now.getTime() < todayAt.getTime()) return todayAt;
  return new Date(todayAt.getTime() + 24 * 60 * 60 * 1000);
}
```

Run: `npx vitest run tests/automationSchedule.test.ts` → PASS.

- [ ] **Step 3: Add the skip-marker helper to `src/lib/automation/run.ts`**

```ts
/** Zero-cost ledger trace: proves the cron fired and explains why it didn't scan. Best-effort. */
export async function insertSkippedScheduledRun(
  supabase: ReturnType<typeof createServiceClient>,
  reason: "paused" | "recent_run",
  now: Date,
): Promise<void> {
  try {
    await supabase.from("automation_runs").insert({
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
      status: "skipped",
      mode: "scheduled",
      skips: [reason],
    });
  } catch {
    // best-effort by design
  }
}
```

- [ ] **Step 4: Rewrite the automation block in `src/app/api/cron/keepalive/route.ts`**

Replace lines 27–44 (the `automation` block) with:

```ts
  const now = new Date();
  let automation:
    | Awaited<ReturnType<typeof runAutomationMonitor>>
    | { status: "skipped"; reason: string } = { status: "skipped", reason: "recent_run" };
  const control = await getAutomationControlState();
  const { data: recent } = await supabase
    .from("automation_runs")
    .select("mode, status")
    .gte("started_at", new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString());
  const decision = scheduledScanDecision(control.paused, (recent ?? []) as { mode: string; status: string }[]);
  if (decision.run) {
    automation = await runAutomationMonitor({ mode: "scheduled" });
  } else {
    automation = { status: "skipped", reason: decision.skipReason };
    await insertSkippedScheduledRun(supabase, decision.skipReason, now);
  }
```

Imports: add `scheduledScanDecision` from `@/lib/automation/schedule` and `insertSkippedScheduledRun` from `@/lib/automation/run`. Keep the CRON_SECRET / preview / touch / purge logic unchanged. Note the existing `.lt`-window purge and touch queries stay as they are.

Also add to the top of the keepalive route (below the imports): `export const maxDuration = 300;` — this route runs the full 1–2 minute pipeline inline and has never declared a duration budget; a scheduled scan killed by the default timeout would leave a stale `running` row (which the Task 1 sweeper would then mark failed, but the scan itself would be lost).

- [ ] **Step 5: Keep public "latest scan" queries honest in `src/lib/queries.ts`**

Skip markers and running rows must not appear as "last scan finished". In BOTH `getDashboardDataUncached`'s `latestAutomation` query and `getLatestPublicScanMeta`, add:

```ts
      .in("status", ["success", "partial", "failed"])
```

(right after the existing `.neq("mode", "dry_run")`).

In `getAutomationAdminData`, additionally return the active run so the UI can resume polling after a reload:

```ts
  const { data: activeRunRows } = await supabase
    .from("automation_runs")
    .select("id, status, mode, started_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);
```

Add `activeRun: ((activeRunRows ?? []) as { id: string; status: string; mode: string; started_at: string }[])[0] ?? null` to the returned object.

- [ ] **Step 6: Run all tests, lint, build; commit**

Run: `npx vitest run` → PASS; `npm run lint`; `npm run build`.

```bash
git add src/lib/automation/schedule.ts tests/automationSchedule.test.ts src/app/api/cron/keepalive/route.ts src/lib/automation/run.ts src/lib/queries.ts
git commit -m "fix: dry runs no longer suppress the scheduled scan; skips leave a ledger trace"
```

---

## Task 4: Scan API — start in background, poll status

**Files:**
- Create: `src/app/api/admin/scan/route.ts`
- Create: `src/app/api/admin/scan/status/route.ts`
- Test: `tests/adminScanRoute.test.ts` (new; mock `@/lib/automation/run`, `@/lib/adminGuard`, `@/lib/supabase` following `tests/adminStatusRoute.test.ts` patterns)

- [ ] **Step 1: Create `src/app/api/admin/scan/route.ts`**

```ts
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, after } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { startAutomationScan } from "@/lib/automation/run";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { isVercelPreview } from "@/lib/previewGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function revalidatePublicSurfaces(): void {
  try {
    revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
    revalidateTag(PUBLIC_ISSUES_TAG, "max");
    revalidateTag(CURRENT_PATCH_TAG, "max");
    revalidatePath("/");
    revalidatePath("/issues");
  } catch {
    // pages self-revalidate within 5 minutes regardless
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isVercelPreview()) return NextResponse.json({ error: "preview_writes_disabled" }, { status: 403 });

  let mode = "";
  try {
    mode = String(((await req.json()) as { mode?: unknown }).mode ?? "");
  } catch {
    mode = "";
  }
  if (mode !== "manual" && mode !== "dry_run") {
    return NextResponse.json({ error: "bad_mode" }, { status: 400 });
  }

  const started = await startAutomationScan({ mode });
  if (started.status === "already_running") {
    return NextResponse.json({ error: "scan_already_running" }, { status: 409 });
  }

  after(async () => {
    try {
      await started.completion;
    } catch {
      // run finalizes its own ledger row; nothing to do here
    }
    if (mode === "manual") revalidatePublicSurfaces();
  });

  return NextResponse.json({ runId: started.runId });
}
```

- [ ] **Step 2: Create `src/app/api/admin/scan/status/route.ts`**

```ts
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { sweepStaleRuns } from "@/lib/automation/run";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RunStatusRow = {
  id: string;
  status: string;
  mode: string;
  progress: Record<string, unknown> | null;
  skips: string[];
  errors: string[];
  started_at: string;
  finished_at: string | null;
};

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const supabase = createServiceClient();
  await sweepStaleRuns(supabase, new Date());

  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, status, mode, progress, skips, errors, started_at, finished_at")
    .eq("id", id)
    .limit(1);
  if (error) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  const row = ((data ?? []) as RunStatusRow[])[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Belt-and-suspenders: if a manual run just finished, refresh public pages now.
  if (
    row.mode === "manual" &&
    row.status !== "running" &&
    row.finished_at &&
    Date.now() - new Date(row.finished_at).getTime() < 2 * 60 * 1000
  ) {
    try {
      revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
      revalidateTag(PUBLIC_ISSUES_TAG, "max");
      revalidateTag(CURRENT_PATCH_TAG, "max");
      revalidatePath("/");
      revalidatePath("/issues");
    } catch {
      // pages self-revalidate within 5 minutes regardless
    }
  }

  return NextResponse.json(row);
}
```

- [ ] **Step 3: Write `tests/adminScanRoute.test.ts`**

Mock `@/lib/adminGuard` (`isAdmin`), `@/lib/automation/run` (`startAutomationScan`, `sweepStaleRuns`), `@/lib/supabase`, and `next/cache`. Assert:
1. Non-admin POST → 401 and `startAutomationScan` not called.
2. Bad mode → 400.
3. Valid `{"mode":"dry_run"}` → 200 with `runId`, `startAutomationScan` called with `{ mode: "dry_run" }`.
4. `already_running` → 409.
5. Status GET for unknown id → 404; for a running row → 200 echoing `progress`.

Note: `after` from `next/server` may need a mock in tests (`vi.mock("next/server", async (importOriginal) => ...)` keeping `NextResponse` real and stubbing `after` to invoke its callback immediately or not at all — do NOT let it hang the test).

- [ ] **Step 4: Run tests, lint, build; commit**

```bash
git add src/app/api/admin/scan tests/adminScanRoute.test.ts
git commit -m "feat: background scan API with polling status endpoint"
```

---

## Task 5: Scan controls UI — live funnel, no more frozen site

**Files:**
- Create: `src/components/ScanControls.tsx` (client component)
- Modify: `src/app/admin/source-monitor/page.tsx`
- Modify: `src/app/admin/actions.ts` (delete `runAutomationDryScan` and `runAutomationCappedScan`)
- Test: update `tests/adminActions.test.ts` if it references the deleted actions (grep first)

- [ ] **Step 1: Create `src/components/ScanControls.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Progress = {
  stage: string;
  searchesDone: number;
  searchTotal: number;
  candidatesSeen: number;
  prefilterRejected: number;
  llmCallsUsed: number;
  kept: number;
  promoted: number;
};

type RunStatus = {
  id: string;
  status: string;
  mode: string;
  progress: Progress | null;
  errors: string[];
};

const STAGE_LABELS: Record<string, string> = {
  starting: "Warming up",
  searching: "Searching public sources",
  screening: "Screening candidates",
  persisting: "Saving qualifying signals",
  done: "Finished",
};

const POLL_MS = 2500;

export function ScanControls({ activeRunId }: { activeRunId: string | null }) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<"manual" | "dry_run" | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/scan/status?id=${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as RunStatus;
        if (cancelled) return;
        setRun(data);
        if (data.status !== "running") {
          stopPolling();
          setRunId(null);
          router.refresh();
        }
      } catch {
        // transient poll failure — keep trying; stale sweep guards the terminal case
      }
    };
    void poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [runId, router, stopPolling]);

  const start = async (mode: "manual" | "dry_run") => {
    setError(null);
    setStarting(mode);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (res.status === 409) {
        setError("A scan is already running — give it a minute.");
        return;
      }
      if (!res.ok || !data.runId) {
        setError(data.error === "preview_writes_disabled" ? "Scans are disabled on preview deployments." : "Could not start the scan. Try again.");
        return;
      }
      setRun(null);
      setRunId(data.runId);
    } catch {
      setError("Could not reach the scan API. Check your connection and try again.");
    } finally {
      setStarting(null);
    }
  };

  const scanning = runId !== null;
  const progress = run?.progress ?? null;
  const finished = run && run.status !== "running";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" disabled={scanning || starting !== null} onClick={() => start("dry_run")}>
          {starting === "dry_run" ? "Starting…" : "Test scan without publishing"}
        </button>
        <button type="button" className="btn" disabled={scanning || starting !== null} onClick={() => start("manual")}>
          {starting === "manual" ? "Starting…" : "Run capped scan now"}
        </button>
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--crimson-bright)" }}>
          {error}
        </p>
      ) : null}

      {scanning || finished ? (
        <div className="panel-inset space-y-2 border p-3 text-sm" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className={finished ? "badge badge-green badge-dot" : "badge badge-amber badge-dot"}>
              {finished ? `scan ${run?.status}` : STAGE_LABELS[progress?.stage ?? "starting"] ?? "Scanning"}
            </span>
            {!finished ? (
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                the site stays usable — this card updates itself
              </span>
            ) : null}
          </div>
          {progress ? (
            <p className="num text-xs" style={{ color: "var(--text-dim)" }}>
              {progress.searchesDone}/{progress.searchTotal} searches · {progress.candidatesSeen} candidates ·{" "}
              {progress.prefilterRejected} pre-filtered · {progress.llmCallsUsed} LLM · {progress.kept} kept ·{" "}
              {progress.promoted} promoted
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Starting the pipeline…
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `src/app/admin/source-monitor/page.tsx`**

- Remove the two `<form action={runAutomationDryScan}>` / `<form action={runAutomationCappedScan}>` blocks and their imports.
- Render `<ScanControls activeRunId={activeRun?.id ?? null} />` in their place (`activeRun` comes from `getAutomationAdminData()` — Task 3 added it).
- Keep the pause form exactly as is.
- Update the explainer paragraph to: `A scan runs in the background — the card above updates itself every few seconds and the rest of the site stays usable. Test scans write only the run ledger (nothing public changes). Capped scans use the monthly budget guardrail and promote only qualifying public signals. Pause affects scheduled scans only; manual runs still work.`

- [ ] **Step 3: Delete the two scan server actions from `src/app/admin/actions.ts`**

Delete `runAutomationDryScan` and `runAutomationCappedScan` (and now-unused imports, e.g. `runAutomationMonitor` if nothing else uses it). Grep `tests/adminActions.test.ts` for references and remove/update those tests.

- [ ] **Step 4: Run tests, lint, build; commit**

```bash
git add src/components/ScanControls.tsx src/app/admin/source-monitor/page.tsx src/app/admin/actions.ts tests/
git commit -m "feat: non-blocking scan controls with live funnel progress"
```

---

## Task 6: Source monitor — scheduled-scan visibility + new readout labels

**Files:**
- Modify: `src/lib/automation/runDisplay.ts`
- Modify: `src/app/admin/source-monitor/page.tsx`
- Test: `tests/automationRunDisplay.test.ts` (extend)

- [ ] **Step 1: Add new skip metadata to `SKIP_META` in `runDisplay.ts`**

```ts
  paused: {
    label: "Scheduled scans paused",
    detail: "The cron fired, but scheduled scans are paused, so no scan started.",
    summaryLabel: "paused",
  },
  recent_run: {
    label: "Recent scan already ran",
    detail: "The cron fired, but a real scan started within the previous 6 hours, so this attempt stood down. Dry runs never block it.",
    summaryLabel: "recent scan already ran",
  },
  scan_already_running: {
    label: "Scan already running",
    detail: "Another scan was still in progress, so this one did not start.",
    summaryLabel: "scan already running",
  },
  stale_running_run: {
    label: "Crashed run cleaned up",
    detail: "A previous run never finished (likely a serverless timeout) and was marked failed by the sweeper.",
    summaryLabel: "crashed run cleaned up",
  },
```

Extend `tests/automationRunDisplay.test.ts`: `summarizeRunMessages(["recent_run"], [])` yields a group labeled "Recent scan already ran".

- [ ] **Step 2: Scheduled-status panel in `source-monitor/page.tsx`**

Inside the "Scheduled cadence" inset, replace the static copy with:

```tsx
import { nextScheduledScanAt } from "@/lib/automation/schedule";
// ...
const nextAttempt = nextScheduledScanAt(new Date());
const lastScheduled = runs.find((run) => run.mode === "scheduled") ?? null;
```

```tsx
<div className="panel-inset border p-3 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
  <div className="stat-label mb-1">Scheduled cadence</div>
  <p>
    Vercel cron attempts a scheduled scan daily at 09:00 UTC. Dry runs never block it; only a real scan in the
    previous 6 hours makes it stand down — and every attempt now leaves a ledger entry below.
  </p>
  <p className="mt-1">
    Next attempt: <span className="num">{formatEasternDateTime(nextAttempt.toISOString())}</span>
  </p>
  <p className="mt-1">
    Last attempt:{" "}
    {lastScheduled
      ? `${formatEasternDateTime(lastScheduled.started_at)} — ${
          lastScheduled.status === "skipped"
            ? summarizeRunMessages(lastScheduled.skips, []).operatorSummary
            : lastScheduled.status
        }`
      : "none recorded yet"}
  </p>
</div>
```

- [ ] **Step 3: Special-case skipped rows in `workSummary`**

In `source-monitor/page.tsx`, at the top of `workSummary`, add (adjusting `RunWork` to include `status: string`):

```ts
  if (run.status === "skipped") return "no scan started — see operator readout";
```

- [ ] **Step 4: Run tests, lint, build; commit**

```bash
git add src/lib/automation/runDisplay.ts src/app/admin/source-monitor/page.tsx tests/automationRunDisplay.test.ts
git commit -m "feat: scheduled-scan visibility and plain-language skip labels"
```

---

## Task 7: Dashboard claims scoreboard

**Files:**
- Create: `src/lib/claims.ts` (pure, testable)
- Create: `tests/claims.test.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write failing tests `tests/claims.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { assessClaims } from "@/lib/claims";

const clusters = [
  {
    id: "c1",
    slug: "map_open_crash_persistent",
    title: "Map-open crash after claimed fix",
    category: "crash_startup",
    strengthScore: 4,
    directReportCount: 1,
    signalCount: 1,
  },
  {
    id: "c2",
    slug: "performance_regression",
    title: "FPS / performance regression since 1.13.00",
    category: "performance",
    strengthScore: 0,
    directReportCount: 0,
    signalCount: 0,
  },
];

describe("assessClaims", () => {
  it("marks a claim disputed when it routes to a cluster with evidence", () => {
    const result = assessClaims(
      [{ fixText: "Fixed an issue where opening the map caused the game to crash.", category: "crash_startup" }],
      clusters,
    );
    expect(result.total).toBe(1);
    expect(result.disputed).toHaveLength(1);
    expect(result.disputed[0]?.cluster?.id).toBe("c1");
  });

  it("keeps claims clean when the routed cluster has no evidence", () => {
    const result = assessClaims(
      [{ fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" }],
      clusters,
    );
    expect(result.disputed).toHaveLength(0);
  });

  it("never disputes claims without a category", () => {
    const result = assessClaims([{ fixText: "Improved the Dye UI.", category: null }], clusters);
    expect(result.disputed).toHaveLength(0);
    expect(result.all[0]?.cluster).toBeNull();
  });
});
```

Note for the worker: `assessClaims` routes with `routeToWatchlistCluster` from `@/lib/automation/route` — read that function first; if the first test's fix text does not actually route to `c1` with the real routing rules, adjust the fix text in the test (NOT the routing rules) until it legitimately routes, mirroring how `isContradictedByEvidence` behaves in `src/app/page.tsx` today.

Run: `npx vitest run tests/claims.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/claims.ts`**

```ts
import { routeToWatchlistCluster } from "@/lib/automation/route";
import type { Category } from "@/lib/constants";

export type ClaimLike = { fixText: string; category: string | null };

export type ClaimClusterLike = {
  id: string;
  slug: string;
  title: string;
  category: string;
  strengthScore: number;
  directReportCount: number;
  signalCount: number;
};

export type AssessedClaim = {
  fixText: string;
  disputed: boolean;
  cluster: ClaimClusterLike | null;
};

export type ClaimsAssessment = {
  total: number;
  disputed: AssessedClaim[];
  all: AssessedClaim[];
};

/** Route each official claimed fix to a watchlist cluster; evidence there disputes the claim. */
export function assessClaims(claims: ClaimLike[], clusters: ClaimClusterLike[]): ClaimsAssessment {
  const all = claims.map((claim) => {
    if (!claim.category) return { fixText: claim.fixText, disputed: false, cluster: null };
    const matched = routeToWatchlistCluster(
      {
        issueTitle: claim.fixText,
        summary: claim.fixText,
        category: claim.category as Category,
        llmClusterSlug: null,
      },
      clusters,
    );
    const cluster = matched ? (clusters.find((candidate) => candidate.id === matched.id) ?? null) : null;
    return { fixText: claim.fixText, disputed: (cluster?.strengthScore ?? 0) > 0, cluster };
  });
  return { total: all.length, disputed: all.filter((claim) => claim.disputed), all };
}
```

Run: `npx vitest run tests/claims.test.ts` → PASS.

- [ ] **Step 3: Replace the claims section in `src/app/page.tsx`**

Delete the `isContradictedByEvidence` function and the whole `{/* Official patch-note claimed fixes */}` section. Import `assessClaims` from `@/lib/claims`. In the component body add:

```ts
  const claims = assessClaims(d.claimedFixes, d.topClusters);
  const watchClusters = d.topClusters.filter((cluster) => cluster.fix_status === "fix_claimed");
```

New section JSX (same position in the page):

```tsx
      {/* Claimed fixes vs community evidence */}
      {d.claimedFixes.length > 0 ? (
        <section className="panel space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="stat-label">Patch {d.currentPatch.version} · claimed fixes vs community evidence</div>
            <a
              href={d.currentPatch.officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="link text-xs"
            >
              Official notes ↗
            </a>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="panel-inset px-4 py-3">
              <div className="stat-value">{claims.total}</div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                official fix claims
              </div>
            </div>
            <div
              className="panel-inset px-4 py-3"
              style={claims.disputed.length > 0 ? { border: "1px solid var(--crimson-edge)" } : undefined}
            >
              <div
                className="stat-value"
                style={{ color: claims.disputed.length > 0 ? "var(--crimson-bright)" : "var(--green-bright)" }}
              >
                {claims.disputed.length}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                disputed by evidence
              </div>
            </div>
            <div className="panel-inset px-4 py-3">
              <div className="stat-value" style={{ color: "var(--amber-bright)" }}>
                {watchClusters.length}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                under watch after claimed fix
              </div>
            </div>
          </div>

          {claims.disputed.length === 0 ? (
            <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              No claimed fix is disputed by player reports or public sources yet. The scanner re-checks every scan.
            </p>
          ) : (
            <div className="space-y-2">
              {claims.disputed.map((claim, index) => (
                <div
                  key={index}
                  className="space-y-1.5 rounded-[10px] border px-3.5 py-3"
                  style={{ borderColor: "var(--crimson-edge)", background: "var(--crimson-tint)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1">&ldquo;{claim.fixText}&rdquo;</span>
                    <span className="badge badge-crimson shrink-0">still reported broken</span>
                  </div>
                  {claim.cluster ? (
                    <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                      <span className="num">{claim.cluster.directReportCount}</span> approved reports ·{" "}
                      <span className="num">{claim.cluster.signalCount}</span> cited sources since the claim —{" "}
                      <Link href="/issues" className="link">
                        view the evidence →
                      </Link>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {watchClusters.length > 0 ? (
            <div className="space-y-1 border-t pt-3">
              {watchClusters.map((cluster) => (
                <Link key={cluster.id} href="/issues" className="flex items-center justify-between gap-3 py-1 text-sm">
                  <span className="truncate">{cluster.title}</span>
                  <span className="badge badge-amber shrink-0">watching</span>
                </Link>
              ))}
            </div>
          ) : null}

          <details className="border-t pt-3 text-sm">
            <summary className="cursor-pointer text-xs" style={{ color: "var(--text-faint)" }}>
              View all {claims.total} claims
            </summary>
            <div className="mt-3 space-y-2">
              {claims.all.map((claim, index) => (
                <div key={index} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1" style={{ color: "var(--text-dim)" }}>
                    {claim.fixText}
                  </span>
                  {claim.disputed ? <span className="badge badge-crimson shrink-0">still reported broken</span> : null}
                </div>
              ))}
            </div>
          </details>

          <p className="border-t pt-3 text-xs" style={{ color: "var(--text-faint)" }}>
            Sourced from Pearl Abyss&apos;s official patch notes. A claim is disputed only when approved reports or
            cited public sources contradict it.
          </p>
        </section>
      ) : null}
```

- [ ] **Step 4: Run tests, lint, build; commit**

```bash
git add src/lib/claims.ts tests/claims.test.ts src/app/page.tsx
git commit -m "feat: claims-vs-evidence scoreboard replaces the patch-notes wall"
```

---

## Task 8: Issues page — compact watchlist grid

**Files:**
- Modify: `src/app/issues/page.tsx`

- [ ] **Step 1: Replace the watchlist section**

In `IssuesPage`, replace the `{watchlist.length > 0 ? (...) : null}` section (the one rendering `ClusterCard` per watchlist cluster) with:

```tsx
          {watchlist.length > 0 ? (
            <section className="panel space-y-3">
              <div className="stat-label">Watchlist · scanner is hunting, no evidence yet</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {watchlist.map((cluster) => (
                  <div key={cluster.id} className="panel-inset space-y-1.5 border px-3 py-2.5">
                    <p className="truncate text-sm font-medium">{cluster.title}</p>
                    <div className="flex items-center justify-between gap-2">
                      <EvidenceLadderBadge
                        state={clusterEvidenceState({
                          directReportCount: cluster.directReportCount,
                          publicSignalCount: cluster.signalCount,
                          candidateSignalCount: cluster.candidateSignalCount,
                        })}
                      />
                      <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                        {CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}
                      </span>
                    </div>
                    {cluster.candidateSignalCount > 0 ? (
                      <p className="text-xs" style={{ color: "var(--blue)" }}>
                        {cluster.candidateSignalCount} unconfirmed mention(s) — not enough separate sources yet
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  A cluster earns its full section — signals, sources, excerpts — the moment the first evidence lands.
                  Scanner last finished {timeAgo(scanMeta?.finishedAt ?? null)}.
                </p>
                <Link href="/report" className="btn btn-ghost btn-sm">
                  Seeing one of these? Report it
                </Link>
              </div>
            </section>
          ) : null}
```

Keep `ClusterCard` itself unchanged (it still renders the evidence-backed clusters; its `empty` branch simply never fires for them). Remove any imports that become unused; keep `timeAgo` (still used by the new footer).

- [ ] **Step 2: Run tests, lint, build; commit**

```bash
git add src/app/issues/page.tsx
git commit -m "feat: compact watchlist grid on the issues page"
```

---

## Task 9: Full verification sweep

- [ ] **Step 1: Full test suite**

Run: `npx vitest run` → all PASS.

- [ ] **Step 2: Lint + production build**

Run: `npm run lint` → clean. Run: `npm run build` → success, no type errors.

- [ ] **Step 3: Grep for leftovers**

- `grep -r "llmCallUsed" src tests` → zero hits (renamed in Task 2).
- `grep -r "runAutomationCappedScan\|runAutomationDryScan" src tests` → zero hits (deleted in Task 5).
- `grep -r "insertRunLedger" src` → zero hits (replaced in Task 1).

- [ ] **Step 4: Commit any stragglers**

Only if the sweep found fixes: conventional-message commit.

---

## Orchestrator-only follow-ups (NOT subagent tasks)

1. Apply `supabase/migrations/20260706150000_automation_run_progress.sql` to production via Supabase MCP `apply_migration` (additive, safe before merge).
2. Push the feature branch → Vercel builds the preview. Note for the owner: the preview shares the production DB but `previewGuard` blocks scan writes there — the scan button intentionally answers "Scans are disabled on preview deployments." Visual review of dashboard/issues works fully on preview.
3. Owner action: paste `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` into Vercel production env vars.
4. After merge to main: verify a real dry-run scan end-to-end on production, then check the ledger after the next 09:00 UTC window for either a real scheduled run or a `skipped` marker row.
