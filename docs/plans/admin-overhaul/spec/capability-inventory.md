# Admin capability inventory

Slice A — behavior and data spec. Not a mockup and not an implementation plan.

**Baseline:** `origin/main` @ `2a0953a671ebed2cd5a09d147fd755be4458af4e` (merged PR #95, *Record bounded scanner AI cost failure diagnostics*). Newer `main` tips are compatible if they retain this commit.

**Frozen (this overhaul must not change):** 2-hour scheduled cadence and 3 searches per run as the operating baseline; monthly budgets; approved models; cost-safety circuit; OpenRouter key-limit rules; public-output and privacy boundaries from PR #94 / #95; Reddit API remains off.

**Legend**

| Column | Meaning |
| --- | --- |
| Action | Operator-visible control or derived check, as labeled today |
| Current handler | Function / RPC / route that runs now |
| Intended home | Where the overhaul should keep or place the capability |
| Consequence | What a successful act (or a successful read) does |
| Undo / failure | Recovery path; how failure must surface |
| Tests | Primary coverage (re-check before relying on a line) |
| Backend | `reuse` existing support; `missing` needs new durable support |

Anonymous visitors on `/scanner` must keep seeing the public Observatory. Authenticated admins keep the scanner workbench on the same path.

---

## Shared operator shell

Chrome: `src/components/dispatch/Chrome.tsx` (`OperatorShell`). Nav: `src/components/dispatch/OperatorNav.tsx`. Auth: `src/lib/adminGuard.ts`, login return allowlist `src/lib/loginReturn.ts`. Session cookie `cd_admin`; 12-hour expiry (footer copy). Preview writes blocked by `assertProductionWriteAllowed` (`src/lib/previewGuard.ts`).

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Destinations: Overview, Report review, Videos, Scanner monitor, Dossiers | Links to `/operator`, `/admin`, `/admin/videos`, `/scanner`, `/admin/compile` | Same five destinations in `OperatorNav` | Navigate only | N/A | `tests/e2e/public-visual.spec.ts`; `tests/loginReturn.test.ts` | reuse |
| Theme toggle | `ThemeToggle` in operator nameplate | Every operator page | Local theme only; light is server/first-visit default | Device-local | Design notes; public visual suite | reuse |
| Export CSV… / Download CSV | Confirm strip → `GET /api/admin/export` | Utilities register on every operator page | Private 22-field report download (descriptions, repro, hardware, PERS IDs, evidence URLs, every moderation state). Hashes excluded | Cancel closes confirm and restores focus; download is not undone | `tests/adminExport.test.ts`; e2e public-visual | reuse |
| Sign out | `signOutAdmin` (`src/app/admin/actions.ts`) | Utilities register | Clears cookie; redirects `/admin/login` | Sign in again | `tests/adminActionsAuth.test.ts` | reuse |
| Login | `/admin/login` + `LoginForm`; `PublicShell` until signed in | Keep public chrome when signed out | Sets session; `?from=` only if allowlisted | Invalid `from` falls back to `/admin` | `tests/loginReturn.test.ts` | reuse |
| `/admin/source-monitor` | `redirect("/scanner")` | Do not revive as a destination | Compatibility alias | N/A | page exists as redirect | reuse |

**Privacy:** Operator surfaces are `noindex`; footer states they are never linked publicly. Export names its private payload before fetch. Do not put raw report text, rejected-candidate URLs, video IDs, or network hashes in public output.

---

## Overview (`/operator`)

Inspect-only. `src/app/operator/page.tsx` loads `getPublicScannerData`, `getPatchRadarData`, `getAutomationAdminData` via `Promise.allSettled`, then `getScannerAiHealth`. UI: `src/components/newspaper/OperatorOverview.tsx`. Serialiser: `src/lib/operatorOverview.ts` (`safeRunSummary` strips raw `errors[]`).

Today this page’s “Checks to review” is **operational health only**. It is not `/admin` “Needs you”. The overhaul should **name** owner decisions here as well (see metrics contract) without merging them into one undifferentiated number and without making Overview writable.

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Auth gate | `requireAdmin("/operator")` | Keep | Unauthenticated → `/admin/login?from=%2Foperator` | N/A | `tests/adminGuard.test.ts`; login return | reuse |
| Attention count / named exceptions | Derived in `OperatorOverview` from collection lanes, 7d failed runs, AI health, unread registers | Overview (quick check) | Read-only; each named item links to `/scanner` today | Unknown reads render `—`, never a quiet zero | `tests/operatorOverview.test.ts`; `tests/collectionHealth.test.ts`; `tests/scannerAiHealth.test.ts`; e2e `operator-writes.spec.ts` | reuse |
| AI processing status | `getScannerAiHealth` → `scannerAiHealth` (`health.ts` / `health.server.ts`) | Overview + Scanner status line (one AI health item when co-symptomatic; see metrics contract) | Read-only | History unread → `unavailable` / `ai_history_unavailable`, not Idle-as-healthy | `tests/scannerAiHealth.test.ts`; `tests/scannerAiHealthServer.test.ts` | reuse |
| Scanner 7d failed runs | `radar.health.runs7d.failed` | Overview + Scanner | Read-only; `partial` counts as succeeded in radar, not failed | Disconnected radar → failed count `null` / Unknown | `tests/radar.test.ts`; operator overview | reuse |
| Run strip (Completed / Completed with limits / Failed / Skipped / Running) | `admin.runs` → `safeRunSummary` | Overview | Client-only selection; no write | Admin read failure stays explicit (not an empty success strip) | `tests/operatorOverview.test.ts`; `tests/automationRunDisplay.test.ts` | reuse |
| Collection lanes (Steam / Twitch / IGDB) | `collectionHealth` | Overview + Scanner collection block | Read-only; delayed uses provider interval + cadence grace | Unknown ≠ zero captures; disabled is not attention | `tests/collectionHealth.test.ts` | reuse |
| Daily check aside (“9:00 am Eastern”) | Static copy | Overview or drop if it competes with the 10 AM brief | Does **not** call `owner_attention_brief`; must not claim live ChatGPT task status | N/A | copy-only | reuse |
| Links: Scanner / Report review / Dossiers | `<Link>` | Overview footer; also add Videos | Navigate | N/A | page | reuse |
| Owner decisions (flagged reports, claim pairings, video inbox) | **Not rendered on Overview today.** Sources: `readReportReviewQueue` / `splitClusterExceptions` / `countNeedsYou`; `readOwnerAttentionBrief`; video queue | Overview as named counts + next-step links; work stays on `/admin` and `/admin/videos` | Read-only on Overview | Missing video schema → unavailable, not empty; report/cluster read failure must throw or show unavailable, never a green zero | `tests/reportReview.test.ts`; `tests/ownerAttentionBrief.test.ts`; `tests/videoReviewStore.test.ts` | reuse (compose existing reads) |

Cadence and search-depth **controls** are not on Overview. Overview may consume `radar.health.cadenceMinutes` only as collection delay grace. Do not add policy editors here.

---

## Report review (`/admin`)

Page: `src/app/admin/page.tsx`. Queue: `src/lib/reportReview.ts`. Clusters: `src/lib/adminClusters.ts` (complete keyset pager; truncated reads are forbidden because they green-wash Needs you). Writes: `src/app/admin/actions.ts`.

**Needs you today** = pending `bug_reports` + engine-owned rows whose `lifecycle_reason` starts with `Needs review:` (`countNeedsYou`). Maintainer locks are listed in the exception ledger but are **not** new required work.

### Flagged reports

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Queue read (oldest 50 + exact counts) | `readReportReviewQueue` | Report review | Private full text in console only | Any failed/null count throws into the admin error boundary — never a fabricated All clear | `tests/reportReview.test.ts` | reuse |
| Approve | `moderateReport` `decision=approved` | Report review | `moderation_status=approved`; optional `cluster_id`; optional `approved_excerpts` insert (≤500 chars) **after** status write; best-effort `refreshClusterVisibility` | **No re-open UI.** Excerpt insert failure leaves approval committed and the row gone from the queue. Visibility refresh failure is logged, approval kept | `tests/adminActions.test.ts`; `tests/adminActionsAuth.test.ts` | reuse |
| Reject | `moderateReport` `decision=rejected` | Report review | Leaves pending queue; not public evidence; **also writes the cluster select** | No re-open UI | same | reuse |
| Spam | `moderateReport` `decision=spam` | Report review | Same as reject with `spam` status | No re-open UI | same | reuse |
| Cluster select / excerpt field | Shared form inputs on the same POST | Report review | Inputs, not separate actions | Reject/Spam still persist cluster selection (current quirk; keep unless a later slice changes the action) | page + adminActions | reuse |

Public excerpt text is the only report body that may become public, and only after Approve + successful insert. Raw description/repro/hardware stay private.

### Lifecycle exceptions (claim match) — today vs intended

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Surface “Needs review:” / unsure rows | Lifecycle pass `runLifecyclePass` + `computeClusterLifecycle`; UI `splitClusterExceptions` | Report review, **primary work** (not a collapsed afterthought) | Today: rewrite `lifecycle_reason` every scan; keyword proposals reappear | If a later scan maps nothing, the reason clears with no operator act | `tests/lifecycle.test.ts`; `tests/claimMapping.test.ts`; `tests/automationRun.test.ts`; `tests/reportReview.test.ts` | reuse (flagging) |
| Confirm pairing | **None** | Report review claim-review ledger | See `claim-review-contract.md`: accept this official-claim → issue pairing; engine-owned `fix_claimed`; exact-patch clock; **not** game-fixed; **not** `admin_override` | Undo pairing; failed save must keep pending | none for operator confirm | **missing** |
| Not the same issue | **None** | Report review | Reject pairing + required reason; suppress identical proposal across scans | Undo restore to pending | none | **missing** |
| Decide later | **None** | Report review | Pending pairing stays required work; first seen preserved; last seen updates | Confirm or reject later; failed save stays pending | none | **missing** |
| Lock | `setClusterFixStatus` | Break-glass on Report review, **not** the routine claim tool | Issue-wide `admin_override=true`; claim-bearing statuses stamp `fix_claimed_at` + `fix_claimed_patch_version` from current official patch | `Clear lock`; claim-bearing lock refused when patch provenance is `fallback` | `tests/adminActions.test.ts`; `tests/lifecycle.test.ts`; `tests/automationRun.test.ts` | reuse |
| Clear lock | `clearClusterFixStatusOverride` | Beside an active lock | Clears override, reason, and synthesized claim clock; **leaves `fix_status`** until the next lifecycle pass | No restore of the previous clock | `tests/adminActions.test.ts` | reuse |

Lock remains available as an exceptional issue-wide override. It must not be the default control on an unsure keyword flag.

### Visibility and patch break-glass

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Apply break-glass override | `setClusterVisibilityOverride` → RPC `set_cluster_visibility_override` | Report review, visibility ledger | Immediate Issue Board change; independent of lifecycle lock and evidence counts | `Reset to automatic`; reason ≥3 chars + confirm required; missing new RPC signature retries legacy; refresh failure revalidates then throws | `tests/adminActions.test.ts`; e2e operator-writes | reuse |
| Reset to automatic | same action `visibility=auto` | Active override cards | Clears override; restores automatic baseline; recomputes signals | If recompute fails, reset is already committed and the failure is raised | same | reuse |
| Set current patch | `setCurrentPatchOverride` → `set_current_patch_override` | Break-glass disclosure | Manual version becomes current; **no official fix claims** attach; Scanner observation window swaps | No Clear; next successful official sync reclaims | `tests/adminActions.test.ts`; e2e | reuse |

Visibility, evidence, and lifecycle lock are three independent axes. Do not collapse them.

---

## Videos (`/admin/videos`)

PR #94 inbox. Page `src/app/admin/videos/page.tsx`; actions `src/app/admin/videos/actions.ts`; store `src/lib/videoReviewStore.ts`; validation `src/lib/videoReview.ts`. Brief: `src/lib/ownerAttentionBrief.ts`, SQL `owner_attention_brief()`, `GET /api/admin/video-review-brief`.

**Intended home: stay here.** Do not fold into Report review or Scanner. Preserve every #94 behavior below.

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Queue read | `readVideoReviewQueue` | Videos | Lists candidates; missing schema → **unavailable**, never empty | Permission/other DB errors throw | `tests/videoReviewStore.test.ts`; page unavailable copy | reuse |
| Add to inbox | `addVideoReviewCandidate` → `insertVideoReviewCandidate` | Videos | Manual YouTube URL → `pending`; never publishes Watch | Duplicate rejected; validation errors throw; preview writes blocked | `tests/videoReview.test.ts`; `tests/videoReviewActionsAuth.test.ts`; e2e `video-inbox.spec.ts` | reuse |
| Save | `saveVideoReviewCandidate` → `mutate_video_review_candidate` `save` | Videos | Same identity refreshes draft; identity change returns to Pending and deletes previous draft | `StaleVideoReviewEdit`; archived must Restore first | store tests; `docs/OWNER-ATTENTION-BRIEF.md` | reuse |
| Approve draft | `approveVideoCandidate` | Videos | Private later-PR markdown only. No Watch publish, no registry write, no GitHub PR | Idempotent if already `draft_ready`; archived blocked | store + e2e + OWNER brief | reuse |
| Skip | `skipVideoCandidate` | Videos | `skipped`; stays private; no draft | Blocked if `draft_ready` | store | reuse |
| Archive draft | `archiveVideoCandidate` | Videos | Leaves daily brief; keeps private record/download | Restore; only from `draft_ready` | `tests/videoReviewArchive.test.ts`; e2e | reuse |
| Restore draft | `restoreVideoCandidate` | Videos | Back to `draft_ready` and the brief | Only from `archived` | same | reuse |
| Download draft | `GET /api/admin/videos/:id/draft` | Videos | Markdown attachment | 401 / 503 schema missing | `tests/videoReviewPrivacy.test.ts` | reuse |
| Owner brief | `readOwnerAttentionBrief` / `select public.owner_attention_brief();` | 10 AM connector + optional verify | Counts + ≤8 items; no video IDs/URLs/report bodies/review-note copies | `unavailable` ≠ empty; `error` ≠ zeros; `ok` with all zeros stays quiet | `tests/ownerAttentionBrief.test.ts`; `tests/videoReviewPrivacy.test.ts` | reuse |

---

## Authenticated Scanner (`/scanner` when `isAdmin()`)

Page: `src/app/scanner/page.tsx`. UI: `src/components/scanner/AdminScannerView.tsx`, `ScanControls`, `ScannerFeedbackDesk`, `FeedbackRulesPanel`, `RejectedArchive`, `CollectionHealth`.

**Anonymous `/scanner`:** `isAdmin()` is false → render `ObservatoryPage` (public newspaper Observatory). Do not redirect to login. Canonical public route `/observatory` stays. Metadata on `/scanner` remains `robots: { index: false }`. `PublicScannerView` is unit-tested but **not** the live anonymous path.

**Do not change** cadence options’ meaning or the 2h / 3-search operating baseline. Policy form may continue to *display* Hourly / 6h / daily / 1–3 searches; this spec does not authorize changing saved production cadence or search depth.

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Run capped scan now | `POST /api/admin/scan` `{mode:"manual"}` | Scanner header | Real intake; spends Tavily/LLM within caps | Preview disabled; 409 if already running | `tests/adminScanRoute.test.ts`; e2e | reuse |
| Test scan without publishing | same API `dry_run` | Scanner | Funnel without publishing | same | same | reuse |
| Test AI provider route | `POST /api/admin/scan/provider-smoke` | Preview only | Synthetic AI call; no DB writes | Budget/key errors surfaced | ScanControls | reuse |
| Save cadence / credits / AI budget / model preset | `setScannerPolicy` | Scanner “Cadence and budget” | Persists policy; revalidates operator + public | Preview write guard; **this overhaul must not ship a cadence/budget/model change** | `tests/automationSettings.test.ts`; `tests/adminActionsAuth.test.ts` | reuse (do not retune) |
| Pause via cadence form | `setScannerPolicy` with cadence `paused` | Scanner | `control.paused`; AI health becomes Idle (`scanner_paused`), not Unavailable | Unpause via policy | settings tests | reuse |
| `setAutomationPaused` server action | `src/app/admin/actions.ts` | Unwired in `AdminScannerView`; cadence pause is the live UI | Same pause flag | Auth-gated | `tests/adminActions.test.ts` | reuse (dead duplicate UI — do not revive as a second pause control) |
| Keep as relevant | `recordScannerDecision` `relevant` (+ compat `rescueRejectedCandidate`) | Teach desk | Rescue candidate → signal first, then durable Relevant; may spend LLM | Decision-write failure after rescue is retry-safe; Undo while rule active | `tests/adminActionsAuth.test.ts`; scanner feedback tests | reuse |
| Reject and teach (candidate) | `recordScannerDecision` negative | Teach desk | Rule + hide; exact URL default; domain needs `confirm_broad` | `undoScannerDecision` | same | reuse |
| Remove lead and teach (kept signal) | `recordScannerDecision` `target_kind=signal` | Records | Exact-URL only; Steam review teaching refused | Undo when `decision_id` present | `tests/adminScannerView.test.ts` | reuse |
| Reject and teach (observation) | `rejectObservationAndTeach` → `record_observation_decision` | Context lanes | Hide + learning rule in one RPC | Undo; already-hidden blocks a second reject; missing migration throws, item unchanged | admin actions + AdminScannerView | reuse |
| Undo lesson / decision | `undoScannerDecision` → `undo_scanner_decision` | Adjacent to decided items / Active lessons | Restores target; revokes rule when RPC succeeds | Throws if already undone; expired/superseded rules may lack UI recovery | scanner feedback tests | reuse |
| Optional teaching candidates | rejected-candidate inbox | Scanner Teach; **not** Needs you | Private, expiring, optional | Ignore is valid | AdminScannerView copy | reuse |

**PR #95 diagnostics:** private `progress.openRouterDiagnostics` (≤32 allowlisted entries; no bodies/keys/URLs/IDs/report text). Inspection only; not a circuit input. Surfaces may say that bounded diagnostics exist for maintainers; they must not dump the JSON on a public page. Tests: `tests/openRouterDiagnostics.test.ts`, `tests/openRouterCallerDiagnostics.test.ts`, `tests/automationRun.test.ts`.

Learning rules may change discovery/relevance only. They must not publish a lead, bypass corroboration, or alter evidence counts.

---

## Dossiers (`/admin/compile`)

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Compile now | `compileDossier` | Dossiers | Deterministic markdown from **approved** reports, public signals, clusters, excerpts; optional AI prose rewrite; insert `dossier_runs`; redirect `?run=` | No delete-run UI; unknown patch provenance throws (no fallback label); AI failure falls back to deterministic if draft helper returns null | `tests/adminActions.test.ts`; `tests/adminActionsAuth.test.ts` | reuse |
| Draft with AI checkbox | `use_ai` + `features().ai` | Dossiers | Opt-in; disabled without key | Sends private dossier contents to OpenRouter when checked | compile page | reuse (keep opt-in + fallback) |
| Open previous run | `?run=` | Dossiers | Loads saved markdown | Missing id currently **omits** output with no error — treat as a honesty gap (show missing vs none) | gap | reuse read; **missing** explicit missing-run state |
| Copy dossier | `CopyDossierButton` | Dossiers | Clipboard | Copy-failed copy | component | reuse |

Dossier AI is on-demand and unrelated to scanner AI health. A successful dossier draft must not be labeled as scanner AI recovery.

---

## Owner attention brief (10 AM connector)

Not a page. Existing ChatGPT health-check query. Do not create a new schedule.

| Action | Current handler | Intended home | Consequence | Undo / failure | Tests | Backend |
| --- | --- | --- | --- | --- | --- | --- |
| Read brief | RPC `owner_attention_brief` via `readOwnerAttentionBrief` | Stay connector; Overview may *display* the same owner-decision counts | JSON counts + bounded video items | schema/access → `unavailable`; other DB errors → `error`; never invent zeros | `tests/ownerAttentionBrief.test.ts` | reuse; claim-review population change needs a later migration of this function (see claim-review contract). No SQL in this slice |

`adminAttention.needsYou` today = flagged pending reports + `issue_clusters` with `lifecycle_reason like 'Needs review:%'` and `admin_override = false`. After claim-review ships, that second term must count **pending pairings**, not repeat keyword flags. Locks stay excluded.

---

## Capability gaps (truly missing backend)

1. **Durable claim pairing review** — Confirm / Not the same issue / Decide later / history / undo / repeat-scan suppression. Lifecycle mapping and Lock exist; they are the wrong tools for routine pairing work. Specified in `claim-review-contract.md`.
2. **Explicit missing-dossier-run state** — `?run=` with an unknown id should not look like “no runs yet”.
3. **Overview composition of owner decisions** — data already exist; Overview does not read them. Not a new store.

Everything else in this inventory is reuse: report moderation, visibility, patch override, video inbox, scanner teach/undo, scan run, policy form, dossiers, brief, AI health reads, radar/scoreboard registers, #95 diagnostics.

---

## Privacy and public-output boundaries (must survive the overhaul)

| Must not appear in public output | Why |
| --- | --- |
| Raw reports, repro, hardware, evidence URLs, PERS IDs | Private until optional approved excerpt |
| Rejected candidates, private source URLs/text, teaching inbox | Admin-only, expiring |
| Video IDs, source URLs, review notes in the 10 AM brief | Brief contract |
| Network hashes, individual taps | Never public identifiers |
| Twitch/Steam identities as player evidence | Provider context ≠ player evidence |
| `#95` diagnostic bodies, keys, generation IDs | Allowlisted facts only, private run progress |
| Operator run `errors[]` | Overview gets skip summaries only |

Public shapes may contain approved excerpts, explicitly public leads, public IGDB metadata, and aggregate Steam/Twitch context.

---

## Test map (by surface)

| Surface | Tests |
| --- | --- |
| Overview | `tests/operatorOverview.test.ts`, `tests/scannerAiHealth.test.ts`, `tests/scannerAiHealthServer.test.ts`, `tests/collectionHealth.test.ts`, `tests/e2e/operator-writes.spec.ts` |
| Report review | `tests/reportReview.test.ts`, `tests/adminClusters.test.ts`, `tests/adminActions.test.ts`, `tests/adminActionsAuth.test.ts`, `tests/lifecycle.test.ts`, `tests/claimMapping.test.ts`, `tests/automationRun.test.ts` |
| Videos | `tests/videoReviewStore.test.ts`, `tests/videoReview.test.ts`, `tests/videoReviewArchive.test.ts`, `tests/videoReviewActionsAuth.test.ts`, `tests/videoReviewPrivacy.test.ts`, `tests/videoPublicationDraft.test.ts`, `tests/e2e/video-inbox.spec.ts` |
| Brief | `tests/ownerAttentionBrief.test.ts` |
| Scanner | `tests/adminScannerView.test.ts`, `tests/adminScanRoute.test.ts`, `tests/radar.test.ts`, `tests/observatoryMetrics.test.ts`, scanner feedback suites, `tests/openRouterDiagnostics.test.ts` |
| Dossiers / export / auth | `tests/adminActions.test.ts`, `tests/adminExport.test.ts`, `tests/loginReturn.test.ts` |
