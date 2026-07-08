# Scanner tab: one role-aware `/scanner` route — design

Date: 2026-07-07
Status: approved by owner (Option A admin view + public/admin dynamic tab approved via mockups in session)
Branch: `feat/scanner-tab`

## Problem

The admin scanner surface at `/admin/source-monitor` is a five-section vertical
wall — controls, run history, integrations, signals, rejected candidates — all
rendered at the same visual weight and full length. A healthy run that finds real
signal (e.g. the Jul 7 1:00 PM run: 5 found, 2 kept, 2 re-confirmed, 1 held, 0
published) is visually indistinguishable from four empty "scheduled check, nothing
new" heartbeat cards stacked around it. The owner has to *read* to find the news,
and the raw funnel/skip vocabulary (`5 results → 5 screened → 0 deduped → 3
pre-filtered → 2 LLM-eligible → 2 LLM → 2 kept → 0 promoted`) is operator jargon,
not a legible answer.

Separately, none of this is visible to the public. With zero users today, the
scanner's intake quality *is* the product — and the transparency story ("here's how
we turn scattered posts into verified evidence, and here's where we still have
gaps") is exactly the credibility signal a fan-run tracker should lead with.

## Goal

One route, `/scanner`, that renders by who is looking:

- **Anonymous / player** → a quiet, privacy-safe transparency page: the verification
  pipeline, aggregate counts, where the scanner looks (and where it can't yet), and
  links to verified issues / the report form.
- **Owner (admin)** → the full operational dashboard (Option A): a verdict strip, the
  last scan in plain English, a triage queue, source health, and history + settings
  folded behind progressive disclosure.

The admin view is a strict **superset** of the public view. The public view never
receives, renders, or queries any admin-only data.

## Decisions locked (owner)

- **Route + nav label:** `Scanner` at `/scanner`. Nav becomes Dashboard · Issues ·
  Submit report · About · Scanner.
- **Public depth:** full transparency — aggregate scorecard + honest gaps (Reddit
  "coming soon") + pipeline explainer. Matches the product's "make privacy obvious /
  explain disabled integrations clearly" principles.
- **Build order:** both views ship together in one PR.
- **Look:** the approved mockup — existing `globals.css` design language (crimson /
  amber / green severity engine, `panel`, `badge`, mono numerals), committed dark
  (the app is dark-only). Reference: session artifact `option-a` / `dynamic-public-admin`.

## Architecture

`src/app/scanner/page.tsx` — a server component, `export const dynamic =
"force-dynamic"` (the page differs by session, so it cannot be statically cached).

```
const admin = await isAdmin();            // non-throwing boolean, adminGuard.ts
return admin ? <AdminScannerView … /> : <PublicScannerView … />;
```

- `isAdmin()` (not `requireAdmin()`) — anonymous visitors must render, not redirect.
- The two branches fetch **different** data and pass **different** props. There is no
  shared component that receives both public and admin data.
- Public-safe aggregate reads still come from the existing `unstable_cache`
  functions; only the page shell is dynamic.

## Privacy boundary (load-bearing — this is the security invariant)

| Public view (`PublicScannerView`) may show | Admin-only (`AdminScannerView`) |
| --- | --- |
| Verification pipeline (4 steps) + **aggregate counts** (reviewed / filtered / awaiting 2nd source / published) | Triage queue: rejected candidate **titles, URLs, domains** |
| "Where it looks" + honest gaps (Reddit coming soon) | Raw scanner codes, funnel numbers, skip reasons |
| Privacy/evidence promise; links to `/issues`, `/report` | Scanner settings, budget, caps, cost, Run/Test scan controls |
| Status heartbeat ("active · last checked Nm ago") | Any private / un-corroborated signal **content** |

Invariants (must hold in code and be covered by the plan's checks):

1. `PublicScannerView` and the public data function must **never import or call**
   `getAutomationAdminData()`.
2. The public data function (`getPublicScannerData`) selects **only counts /
   aggregates** — never `title`, `url`, `summary`, `raw_text`, or reject reasons from
   private signals or rejected candidates. It follows the existing precedent of
   `getCandidateSignalCountsByCluster` (which selects only `cluster_id`).
3. The admin/public decision is made server-side before render; admin props never
   reach the public component tree.

## Public view — `PublicScannerView`

Sections (all from aggregate-safe data):

1. **Hero** — eyebrow "Community signal · how it's verified", h1 "How the scanner
   works", one-paragraph plain summary, and a status badge
   ("Scanner active · last checked {Nm} ago" from `getLatestPublicScanMeta`).
2. **Verification pipeline** — a 4-step strip (Reviewed → Filtered as noise →
   Awaiting a 2nd source → Published as evidence), each with an aggregate count and a
   one-line plain description, over a green→amber→blue→crimson progress bar. Footer
   line: nothing is published until a second independent source or a verified player
   report confirms it.
3. **Where it looks — and where it could do better** — Web search (on), Steam &
   forums (on), Reddit (coming soon), sourced from `features()` / `integrationStatuses()`.
   Honest-gap note: aggregates only; individual posts/authors/rejected items never shown.
4. **The promise** — three cards: Private by default · Evidence over opinion ·
   Official channel (reuses the existing dashboard trust-note copy).
5. **CTAs** — "See what's verified →" (`/issues`), "Submit a report →" (`/report`).

Public data (`getPublicScannerData` in `queries.ts`, aggregate-only, cached):

- `reviewedThisWeek`, `filteredThisWeek` — summed from `automation_runs` funnel
  fields over the last 7 days (counts only).
- `awaiting` — public clusters with `candidateSignalCount > 0` or `fix_status =
  'fix_claimed'` (already derivable from `getDashboardData().topClusters`).
- `published` — count of live public clusters / evidence-backed signals (already in
  `getDashboardData`).
- `lastCheckedAt`, `scannerActive` — from `getLatestPublicScanMeta` + `scanner.paused`.

If the funnel aggregate cannot be derived cleanly from existing columns, the
fallback is to show the pipeline **labels without live counts** rather than invent
numbers — never fabricate, never leak.

## Admin view — `AdminScannerView`

Reuses existing logic from `admin/source-monitor/page.tsx` (status computation,
next-eligible-run, projected credits) and existing components/actions. Sections:

1. **Title + actions** — "Source monitor" + `Test scan` / `Run a scan now`. Scan
   buttons and live progress are the **existing `ScanControls`** component (background
   scan via `/api/admin/scan`, polling `/api/admin/scan/status`). Its progress string
   gets a plain-language pass (see translation layer) but the wiring is unchanged.
2. **Sticky verdict strip** — status (Active/Running/Paused/Capped) + one-sentence
   plain verdict + state badges (Reddit off, next check) + a 3-tile scorecard
   (Live now / Watching / Kept this week).
3. **Last scan, in plain English** — the newest real (non-dry-run) run rendered via
   the translation layer: "Checked N sources, kept M real reports", a kept/dropped
   bar, and outcome chips (re-confirmed / held / published), plus the honest
   "dropped correctly" and "needs a 2nd source / turn on Reddit" notes.
4. **Needs your eyes** (triage) — `rejectedCandidates` with humanized reasons and the
   existing `rescueRejectedCandidate` action (Rescue button). Admin-only.
5. **Where it gets its info** — source health + budget used this month.
6. **Heartbeat collapse** — consecutive "ran, nothing new" scheduled runs collapse to
   a single dim line ("N scheduled checks found nothing new — that's normal").
7. **Folded: Scan history** — compact plain rows ("1:00 PM · found 5, kept 2 · $0.02")
   with a nested "Show raw scanner codes" disclosure preserving the funnel/skip detail
   for debugging.
8. **Folded: Scanner settings & budget** — the existing `setScannerPolicy` form
   (cadence, search depth, caps, advanced route), collapsed by default.

## "Dumb down the data" — translation layer

A small display layer (extend `src/lib/automation/runDisplay.ts`; no new pipeline
logic) turns run rows and codes into plain language, shared by admin history and the
"last scan" panel:

- `describeScanPlain(run)` → `{ found, kept, reConfirmed, held, published, droppedCount }`
  mapped from existing fields (`search_results_seen`, `signals_inserted`,
  `signals_reobserved`, `candidates_rescued`, `clusters_promoted`, funnel
  `prefilterRejected`).
- Plain skip phrasings (extend `SKIP_META` with a `plain` string, or a sibling map):
  `wrong_patch` → "about a different patch", `source_not_issue_report` → "not a bug
  report", `reddit_disabled` → "Reddit source is off", etc.
- Triage reason humanization for the queue ("looks like an announcement, not a bug" /
  "reads like a guide, not a problem").

The raw funnel/skip strings remain available behind the admin "Show raw scanner
codes" disclosure — dumbed-down by default, precise on demand.

## Files

Create:
- `src/app/scanner/page.tsx` — role-aware server route.
- `src/components/scanner/PublicScannerView.tsx`.
- `src/components/scanner/AdminScannerView.tsx`.
- `getPublicScannerData()` in `src/lib/queries.ts` (aggregate-only, cached with the
  public dashboard tag).
- Translation helpers in `src/lib/automation/runDisplay.ts`.

Modify:
- `src/components/NavLinks.tsx` — add `{ href: "/scanner", label: "Scanner" }`.
- `src/app/admin/source-monitor/page.tsx` — replace with a permanent redirect to
  `/scanner` (preserve bookmarks/links; admin view now lives there).
- `src/app/admin/actions.ts` — add `revalidatePath("/scanner")` to `setScannerPolicy`,
  `rescueRejectedCandidate`, `setAutomationPaused`, `runRedditMonitor`.
- `src/lib/revalidate.ts` — include `/scanner` in `revalidatePublicSurfaces` so
  public counts refresh after a scan/moderation.
- `src/app/page.tsx` — point the dashboard "Automated scanner" card at `/scanner`
  ("How the scanner works →").
- Small additions to `src/app/globals.css` only where a class isn't already available
  (pipeline steps, verdict strip); reuse `panel` / `badge` / `chip` / `meter` first.

## Security & safety

- Reuse existing guards: admin write actions keep `requireAdmin()` +
  `assertProductionWriteAllowed()`. The public route performs **no writes**.
- **No schema changes.** No migrations, no SQL, no `supabase db push`. All data comes
  from existing tables/columns (per repo DB-safety rule). If a clean public aggregate
  proves impossible without a schema change, stop and raise it — do not add a migration.

## Testing / verification

- `npm run lint` + `npm run build` gate the work.
- Anonymous render: `/scanner` shows only public sections; assert no rejected-candidate
  titles/URLs, no settings, no raw codes, no cost appear in the anonymous HTML.
- Admin render: with a valid session cookie, `/scanner` shows the full dashboard;
  triage Rescue and settings Save still work (reused actions).
- Redirect: `/admin/source-monitor` 3xx-redirects to `/scanner`.
- Plain-language: the "last scan" panel and history rows contain no raw funnel/skip
  codes at the surface; raw codes appear only inside the admin disclosure.
- Drive the real page in a browser preview (per repo `verify`): anonymous vs. admin.

## Out of scope

- Live progress-string redesign beyond a plain-language pass on the existing card.
- New scanner pipeline behavior, promotion rules, moderation flow, or report-form changes.
- Reddit activation (owner pastes creds into Vercel — not a code change).
- A dedicated per-patch receipts page.
```