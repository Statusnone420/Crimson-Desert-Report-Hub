# Dashboard rescue: claims scoreboard, watchlist grid, live scans, cron trust — design

Date: 2026-07-06
Status: approved by owner (mockups reviewed inline in session)

## Problem

The backend trust pipeline works (7 clusters, 6 public signals across 3 independent
domains, 2 clusters legitimately promoted, $0.04/run against a $5/month budget), but
four things undermine the product:

1. **Dashboard claims wall.** "What patch 1.13.00 claims to fix" renders all ~31
   official patch-note lines, each with a gray "no reports against it" chip. Thirty-one
   rows of "nothing happened" dominate the page while the actual evidence board sits
   below the fold.
2. **Issues page dead weight.** The 4 zero-evidence watchlist clusters render as
   full-width sections with empty "community signals" placeholders at the bottom of
   the otherwise-strong Issues page.
3. **Manual scans freeze the site.** "Run capped scan" is a Next.js server action that
   runs the whole 1–2 minute pipeline inline. In-flight server actions block all
   router navigation in that tab, and no progress is visible because the ledger row is
   only written when the run finishes.
4. **Scheduled scans silently skip.** The keepalive cron skips automation when *any*
   run (including dry runs) started in the previous 6 hours, and a skipped attempt
   writes no ledger row. The owner's 2:52 AM EDT dry run suppressed the 9:00 UTC
   scheduled scan with zero trace. Separately, a Jul 5 scheduled run skipped with
   `budget_zero` — the budget math needs verification.

Bonus finding: across the last 3 runs, ~8 `openrouter_invalid_json` + 4
`openrouter_provider_failure` skips mean roughly a third of LLM candidates are dropped
by free-model flakiness, not by irrelevance. Reddit is also disabled on every run
(`reddit_disabled`) even though the Reddit app exists — creds were never pasted into
Vercel.

## Site's job (owner's answer, verbatim intent)

The hub exists so a player's report is *heard*: filed, corroborated by other reports
and cited public sources, and visibly verified — instead of vanishing into Reddit/X.
The dashboard leads with the living evidence board; claims-vs-reality is a sharp
supporting scoreboard, not a wall.

## Workstream 1 — Claims scoreboard (dashboard)

Replace the claims section in `src/app/page.tsx` with a single panel:

- **Scoreboard strip** (3 inset metric tiles, mono numerals):
  - `N official fix claims` (neutral)
  - `N disputed by evidence` (green when 0, crimson tile + crimson edge when > 0)
  - `N under watch after claimed fix` (amber; count of public clusters with
    `fix_status = 'fix_claimed'`)
- **Status line** (one sentence): "No claimed fix is disputed by player reports or
  public sources yet. The scanner re-checks every scan." Swaps to a disputed summary
  when disputes exist.
- **Watch rows**: the `fix_claimed` clusters as compact rows with amber `watching`
  badges, linking to `/issues`.
- **Disputed rows** (only when they exist): crimson-tinted row with the claim text, a
  `still reported broken` badge, and an evidence line —
  "N approved reports · M cited sources since the claim — view the evidence →"
  linking to `/issues`. Disputed detection reuses the existing
  `isContradictedByEvidence` routing (claim text routed to a watchlist cluster with
  `strengthScore > 0`).
- **Full list**: native `<details>` expander "View all N claims" containing the
  current rows (kept for transparency, collapsed by default, no chips inside — a
  disputed/clean marker only where it differs).

No schema changes; all inputs (`claimedFixes`, `topClusters`) already load in
`getDashboardData`.

## Workstream 2 — Issues page watchlist grid

In `src/app/issues/page.tsx`, clusters without evidence (`!hasClusterEvidence`) stop
rendering as full sections. They render as one panel titled
"Watchlist · scanner is hunting, no evidence yet" with a responsive card grid
(2-up on desktop). Card = cluster title, badge, category label:

- Badge is `Watching` (dim) normally.
- If `candidateSignalCount > 0`, badge becomes blue `N unconfirmed mention(s)` —
  count only, never private signal content (matches the existing public-page privacy
  rule: only `cluster_id` is selected from private signals).

Footer microcopy: "A cluster earns its full section — signals, sources, excerpts —
the moment the first evidence lands." Clusters with evidence keep the existing full
sections, unchanged.

## Workstream 3 — Background scan with live funnel progress

**Schema.** Migration adds to `automation_runs`: `progress jsonb` (nullable). A run
now has lifecycle `running → success | partial | failed | skipped`.

**Run pipeline.** `runAutomationMonitor` changes:

- Insert the ledger row **at start** with `status: 'running'`, `finished_at: null`.
- Accept an `onProgress` callback; at stage boundaries write `progress`:
  `{ stage: 'searching' | 'prefilter' | 'extracting' | 'persisting' | 'done',
     searchesDone, searchTotal, candidatesSeen, prefilterRejected, llmCallsUsed,
     kept, promoted }`. Progress writes are best-effort (failures don't fail the run).
- Finalize the same row at the end (status, funnel, costs, `finished_at`).
- Stale sweep: when a new run starts, any `running` row older than 15 minutes is
  finalized as `failed` with error `stale_running_run` (crash safety — a killed
  serverless function can never finalize its own row).

**API.** New route handlers under admin guard + production-write guard:

- `POST /api/admin/scan` `{ mode: 'manual' | 'dry_run' }` — refuses (409) if a
  non-stale `running` row exists; otherwise creates the run, kicks the pipeline via
  `waitUntil` (`@vercel/functions`), and immediately returns `{ runId }`.
  `export const maxDuration = 300`.
- `GET /api/admin/scan/status?id=` — returns `{ status, progress, funnel, readout }`
  for polling. Marks/reports stale running rows (> 15 min) as failed.

**UI (Source Monitor).** The scan buttons move from server actions to a client
component that calls the API:

- On start: button flips to scanning state; a live progress card appears showing the
  funnel filling in (`searching 3/5 · 25 candidates · 12 prefiltered · 7 LLM · 7 kept
  · 2 promoted`) polled every ~2.5s.
- On completion: card resolves into the normal operator readout and the runs list
  refreshes (`router.refresh()`); public pages revalidate server-side after the run
  (the pipeline finalizer calls the existing revalidate helpers via the API route).
- The rest of the page stays fully usable the whole time; closing the tab does not
  kill the run.
- Old server actions `runAutomationCappedScan` / `runAutomationDryScan` are removed
  (replaced by the route).

## Workstream 4 — Cron trust

In `src/app/api/cron/keepalive/route.ts`:

- The 6-hour recent-run check counts only rows with `mode in ('scheduled','manual')`
  **and** `status not in ('skipped')` (dry runs and skip markers never suppress a
  scheduled scan).
- When the cron skips (recent run or paused), insert a zero-cost ledger row:
  `mode: 'scheduled', status: 'skipped', skips: ['recent_run' | 'paused']` so the
  Source Monitor can always answer "the cron fired at X and did/didn't scan because Y."
- Budget verification: investigate why Jul 5 19:56 UTC scheduled run skipped with
  `budget_zero` (`computeAutomationBudget` daily-allowance math); fix so the daily
  scheduled scan reliably gets its ~$0.04 while the $5/month cap holds.

Source Monitor additions: "Next scheduled attempt: 09:00 UTC (5:00 AM Florida)" plus
the outcome of the most recent scheduled attempt (ran / skipped + reason), sourced
from the ledger. `runDisplay` maps the new codes (`recent_run`, `stale_running_run`)
to plain-language readout lines.

## Workstream 5 — Extraction yield

- `extractSignalWithOpenRouter`: on `invalid_json` or `provider_failure`, retry once
  (possibly with the next free model in the rotation). The retry consumes LLM
  allowance (honest budgeting). Skip codes distinguish `_retried` successes only in
  the funnel counts; ledger skip codes stay stable.
- Owner action (not code): paste `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`,
  `REDDIT_USER_AGENT` into Vercel production env vars to activate the already-built
  Reddit source.

## Error handling

- Progress writes and skip-marker inserts are best-effort; failures degrade to the
  current behavior (no progress / no marker), never fail a run or the cron response.
- The status endpoint never 500s for a missing run — returns `not_found` for the UI
  to handle.
- If `waitUntil` is unavailable (non-Vercel runtime), the route falls back to awaiting
  the run inline — behavior degrades to today's (slow response) but the progress UI
  still works because the row is written at start.

## Testing

- `npm run lint` + `npm run build` gate every task.
- Local dev has intentionally blank Supabase creds, so pipeline testing happens against
  production with `mode: 'dry_run'` (writes only the ledger; no public changes) after
  deploy. Verify: progress card fills, site stays navigable, run finalizes, skip
  markers appear, next-scan line renders.
- Dashboard/issues rendering verified with the preview server against current
  production data shapes (2 evidence clusters, 4 watchlist, 1 candidate mention).
- Cron fix verified by ledger inspection after the next 09:00 UTC window.

## Out of scope today

- Dedicated `/patch/<version>` receipts page (possible later; expander covers it).
- New evidence-ladder mechanics, moderation flow, or report-form changes.
- Paid models, extra search queries, or budget increases.
