# Slice A independent review — Spec (#96) + Concept (#97)

> Historical review of PRs #96 and #97. The replacement implementation and current verification are documented in [the implementation record](../SLICE-A-HANDOFF.md). This verdict does not describe the replacement.
Reviewer: Slice A Agent 3. Did not author either input. Did not edit `docs/plans/admin-overhaul/spec/` or `docs/plans/admin-overhaul/concept/`. No application code, migrations, paid calls, or merges.

**Inputs**

- Spec PR #96, `cursor/slice-a-admin-spec-0b16` @ `cac22aa`
- Concept PR #97, `slice-a/admin-concept` @ `86a6086`
- Code baseline: `origin/main` @ `2a0953a` (includes #94 video inbox and #95 AI diagnostics)

**Method:** read-only trace of current handlers against both docs; visual pass of committed concept PNGs; source read of `concept.js` / `concept.css` / `capture-screenshots.cjs` / `VERIFICATION.md`. Playwright was not re-run here (project `node_modules` has no Playwright package in this environment). Capture claims that are not in the PNGs or source are treated as unverified.

---

## Verdict

**NEEDS FIXES** before owner visual/behavior review can treat Spec + Concept as one contract.

Do not rubber-stamp. The spec is mostly faithful to `main`. The concept is a usable desk sketch. Together they still disagree on attention arithmetic, claim-reject UX, Lock placement, and what `/admin` keeps. An owner looking at the HTML would approve a different product than Slice B would implement from the spec.

### Fixes required (blocking)

1. **Align Overview attention.** Spec requires two named lists (owner decisions vs operational incidents) whose count expands to identities. Concept “Do now” numeral is flagged reports + claim matches only, while the list also shows Video (and, when AI-blocked, AI mapping). AI is duplicated in Informational. Pick one arithmetic and one family split; do not ship both.
2. **Name owner-decision items.** Overview must not collapse reports + pairings into a single “Review queue” blob. Spec and the owner brief require identifiable items (at least: N flagged reports, M pairings, video pending, video drafts), each with a next step.
3. **Add the required “Not the same issue” reason** (3–500 chars) to the concept, or change the spec. The concept posts reject with no reason.
4. **Resolve Lock on the claim card.** Spec forbids a “game is fixed” control on the pairing card and says Lock is not the routine reject tool. Concept still mounts Lock (including “Marked fixed by maintainer”) on that card. Spec `open-decisions.md` and concept `open-visual-decisions.md` both leave this open — it is not decided.
5. **Restore `/admin` break-glass on the Review concept, or explicitly defer it.** Visibility override + Reset and current-patch override exist on `/admin` today and the spec keeps them there. The concept Review desk omits both.
6. **Complete evidence for owner-required states.** Unavailable and AI-blocked exist only as desktop-light extras. No mobile/dark captures. No pairing failed-save. No second-scan reject-durability demo. No reduced-motion PNG. `VERIFICATION.md` over-claims 320px review-detail overflow.

### Non-blocking but must not be ignored

- Nav/metric labels differ (Review vs Report review; Do now vs Checks to review / owner decisions; Confirm this is the same vs Confirm pairing).
- Video inbox copy says “publication decision”; #94 / spec say Approve is a private later-PR draft only.
- Export confirm has no Download CSV; theme control is 40px; no 12-hour footer; Overview run strip of ≤10 runs is gone.
- Spec test bullet “Later does not increment Needs you” contradicts the contract that Later still counts as pending (one item).

---

## Contradictions

### Spec vs Concept (owner-facing)

| Topic | Spec (#96) | Concept (#97) | Why it matters |
| --- | --- | --- | --- |
| Overview lists | Owner-decision row + operational-incident row. Quiet copy “Running quietly.” only when **both** known empty. Inventory (awaiting/yield/weekly) stays off Overview. | “Do now” vs “Informational”. Informational is a full healthy-status column (captures, patch, 9:00am check, approved/spam). Quiet copy is “No decisions waiting.” | Owner would approve a status board; Slice B would build exception lists. |
| Attention numeral | Sum is optional; identities required. Owner decisions include flagged reports, pending pairings, video pending, video drafts. AI+circuit is operational and counts once. | Numeral = reports + claims only (`reviewChoreCount`). Caption: “2 reports · 1 claim · not inventory”. Video is a Do-now **row** excluded from the 3. AI-blocked adds a third Do-now row **and** Informational “Blocked”, while the 3 does not include AI. | Numeral, list, and spec families are three different products. Concept `open-visual-decisions.md` #3 admits this and still ships the mixed UI. |
| Identifiable items | “3 checks to review with no identities is a failed readout.” Named: flagged reports, pairings, videos. | One “Review queue” row: “2 flagged reports and 1 unsure claim match.” No titles, no pairing identity, no video-draft count. | Fails owner criterion attention → identifiable items. |
| Claim actions | Confirm pairing / Not the same issue / Decide later. Reject **requires** reason 3–500 chars. Undo + history in-spec. | “Confirm this is the same” / “Not the same” / “Decide later”. No reason field. No undo. Confirm keeps the row in the queue as “Kept in queue” then advances. | Reject without a reason cannot satisfy the spec store. Demo “keep in queue” is not production pending arithmetic. |
| Lock | Not the routine pairing tool. Pairing card must not offer a “game is fixed” control. Lock remains exceptional on Report review (Open / Fix claimed / Marked fixed / Still happening). | Primary actions are the three pairing buttons (good). Lock is a dashed disclosure **on the same card**, with Marked fixed by maintainer. | Concept `open-visual-decisions.md` #6 vs spec “What the operator must see” item 6. Unresolved. |
| Review surface contents | Flagged reports **and** claim pairings as primary work; visibility ledger + current-patch override stay as break-glass on `/admin`. | Queue = 1 claim + 2 reports. No visibility UI. No patch override. | Silent drop of load-bearing `/admin` capabilities (see retained capabilities). |
| Nav labels | Overview, **Report review**, Videos, **Scanner monitor**, Dossiers (`OperatorNav`). | Overview, **Review**, Videos, **Scanner**, Dossiers. | Same destinations, different names. Spec surface-notes still say “Report review”. |
| AI labels | Available / Unavailable / Limited / Idle (`scannerAiHealth` mapped in `OperatorOverview`). Cost-unverified + circuit open = **one** item. | “Available” / “Blocked” / “Unknown”. No Limited, no Idle, no circuit co-symptom fixture. | “Blocked” is not a code state. AI-blocked is also the wrong family for Do now. |
| Quiet / unavailable CTAs | Named unavailable; never “Open the queue anyway” as if the read succeeded. | Unavailable Overview: “Open Review anyway →”. Same scenario also makes Review “Queue unavailable”. | Teaches the owner a next step the spec forbids treating as a live queue. |
| Video row | Awaiting review → Approve draft or Skip. Drafts ready separately. Approve is **not** publication. | “One submitted YouTube link has no **publication decision** yet.” Inert “Videos (not in this concept)”. No drafts-ready identity. | Contradicts #94 and `docs/OWNER-ATTENTION-BRIEF.md`. |
| Export | Confirm strip names the 22-field private payload, then **Download CSV**; Escape returns focus to the trigger (`OperatorNav`). | Confirm copy only; **no Download**; Escape closes; no focus return. | Shell regression vs current code and spec. |
| Run history | Overview keeps an inspect-only strip of latest ≤10 authenticated runs; Completed ≠ healthy AI. | Single Informational line “Last scanner run · completed with limits”. | Drops a current Overview capability the spec said to keep. |
| Claim card fields | Exact `fix_text`, official URL, exact patch + provenance, slug/category/public flag, short description without raw reports, proposal kind, `firstSeenAt` / `lastSeenAt` / `seenCount`. | Invented quote + sample citation (not a URL). No URL, slug, public flag, sightings, provenance Synced/Manual/Unknown (says “sample, not live-synced”). | Concept proves the quote treatment, not the contract. |
| Failed save | Pairing **or** report stays on screen with the error. Do not hide Approve-already-committed when excerpt insert throws. | Only a report failed-save. Retry Approve **succeeds** and advances. Excerpt is kept (good). Does not show the real excerpt-after-approve split. No pairing failed-save / stale revision. | Owner will think retry-is-safe is the production story. It is not, for excerpt insert (`moderateReport`). |
| Decide later | Still **one** Needs-you item; last seen updates; no expiry; later `llm_sure` may auto-confirm (open decision #3). | `later` announces “Still in the queue” and does not mark `decisions[]`. No last-seen, no auto-sure, no second scan. | Spec behavior is invisible in the concept. |
| Theme target size | DESIGN.md / spec: 44px controls. | `.theme-toggle` is **40×40px**. | Fails the keyboard/touch floor the spec cited. |

### Spec-internal

- `claim-review-contract.md` §Decide later: Later “counts the same as pending in Needs you”.
- Same file, tests a later slice must add: “Later does not increment Needs you.”
- Those cannot both be implemented as written. The contract body is the intended rule (still one pending item, do not add a second). The test bullet will cause a false Slice C “fix”.

- Spec §What the operator must see: no “game is fixed” control on the pairing card.
- Spec §Lock: Lock on Report review still offers “Marked fixed by maintainer”.
- Concept follows the second. The first is unmet unless Lock leaves that card.

### Concept-internal

- `open-visual-decisions.md` #3 (Videos/AI in the numeral vs extra rows) is undecided, but the HTML already picked extra rows **and** still puts AI in Do now.
- `README.md` says Lock is “a separate disclosure — it is not the reject control” (true of button order) while #6 asks whether Lock should be off the claim desk entirely.
- Failed-save prefill excerpt (“Camera hitch after sliding on ice”) does not match the open report (“Skill input drops after dismount”). Fine for “typed text is kept”; easy to misread as production excerpt generation.

---

## Missing evidence / unverified claims

Owner brief asked desktop/mobile, both themes, empty / unavailable / AI-blocked / failed-save, keyboard, reduced motion, reject durable across scans, no app integration.

### Screenshot matrix (committed PNGs)

Captured for **both** themes × **both** viewports (1440×1100 and 390×844):

- Overview normal, Overview empty, Review claim, Review failed-save (report)

**Missing** (required by the owner matrix, only desktop-light extras exist):

- Overview unavailable — no mobile, no dark
- Overview AI-blocked — no mobile, no dark
- Review AI-blocked (keyword proposal + exact notes) — **no PNG at all**
- Review unavailable — no PNG
- Review empty — no PNG
- Pairing failed-save / stale revision — no PNG
- Confirm / Not the same / Decide later **after** the click (queue “Kept in queue”) — none; `VERIFICATION.md` only logs text
- Reduced motion — no PNG (`VERIFICATION.md` admits this)
- Lock disclosure **open** (Marked fixed visible) — claim PNG shows the collapsed summary only
- Mobile claim 390×844 clips issue facts / Lock under sticky actions (`VERIFICATION.md` admits Confirm stayed in viewport; facts/Lock are not evidenced)

`capture-screenshots.cjs` never requests those extra hashes. The gaps are in the capture list, not a lost file.

### `VERIFICATION.md` honesty

- Claims 320×844 Review claim detail `scrollWidth === clientWidth` (delta 0). The capture script’s pass bar is `rv320.scrollWidth - clientWidth <= 8`. Those are not the same claim. Capture log is **not** in the PR, so the 0px claim is unverified.
- Keyboard: 18 Tabs on Overview never reach Failed-save or Do-now jumps (admitted). Full claim-form Tab, reverse Tab, screen reader, Export Escape+focus return, mobile Escape-to-queue: **not** run.
- `document.documentElement.style.zoom = 2` is admitted as not browser View → Zoom 200%.
- Firefox / Safari / physical phone: not used.
- Contrast: not metered.
- “Confirm keeps the queue row” is scripted against in-memory HTML, not a second lifecycle pass.

### Owner behaviors the concept cannot show

- **Reject durable across scans.** `applyScenario` wipes `state.decisions`. There is no “scan again” fixture. Durability lives only in the spec (missing backend). Visual review cannot validate it.
- **Lock is not routine reject.** Partially shown (disclosure, copy). Still present on the card with verified-fixed.
- **Attention → identifiable items.** Failed on Overview (aggregated “Review queue”). Partially passed on Review (queue titles).
- **#94 video inbox / #95 diagnostics / authenticated Scanner / Dossiers.** Spec inventories them. Concept nav is inert. No evidence those surfaces survive the overhaul visually.
- **AI + cost-safety circuit as one item.** No fixture. AI-blocked uses key-limit copy (`openrouter_key_budget_unverified` family), which spec lists as **independent** of circuit pause — and then still double-displays it.

### Spec claims without Slice A proof (acceptable as spec-only, not as “shown”)

Durable pairing store, rolling-deploy pairing-unavailable vs string-prefix Needs you, `owner_attention_brief` population change, Confirm without `admin_override`, clock preservation, `llm_sure` suppression after reject. Correctly marked missing backend. Must not be treated as concept-verified.

---

## Code-accuracy issues

Spec vs `origin/main` @ `2a0953a`. Concept vs the same, where it implies current behavior.

### Spec that matches code (do not “fix” these as if the spec were wrong)

- Anonymous `/scanner` renders `ObservatoryPage`; no login bounce. `src/app/scanner/page.tsx`. `/observatory` remains. `robots.index: false` on `/scanner`. `PublicScannerView` is unit-tested and not the live anonymous path.
- Needs you = pending `bug_reports` + engine-owned `lifecycle_reason` prefix `Needs review:` (`countNeedsYou`, `splitClusterExceptions` in `src/lib/reportReview.ts`; brief SQL in `supabase/migrations/20260907030544_video_review_inbox.sql`). Locks excluded.
- Keyword / unsure rewrite every scan; `matchKind: none` clears stored reason (`src/lib/lifecycle.ts`, `writeLifecycleResult` in `src/lib/automation/run.ts`). Lock is the only routine operator control on those rows (`src/app/admin/page.tsx`).
- `loadLifecycleClusters` filters `is_public = true`. Official claims unique `(board_no, position)` and delete/reinsert on sync.
- Claim mapping falls back to `keyword_proposal` when the key is missing, budget/time/route/cost/JSON fail (`src/lib/automation/claimMapping.ts`).
- Lock = `setClusterFixStatus` → `admin_override=true`; claim-bearing lock refused on fallback provenance; Clear leaves `fix_status` (`src/app/admin/actions.ts`).
- Approve writes status then excerpt; excerpt failure throws after approval; Reject/Spam also persist `cluster_id`.
- Overview attention **today** is operational only: `collection.attentionCount + (scannerFailedRuns ?? 0) + Number(aiUnavailableOrLimited)` (`src/components/newspaper/OperatorOverview.tsx`). Unknown formula matches the spec’s “today” block.
- Scanner “Checks to review” **today** = `failedRuns7d + pausedIntegrations.length + collection.attentionCount + Number(aiNeedsAttention)` (`src/components/scanner/AdminScannerView.tsx`). Spec is right that this **double-counts** AI unavailable + OpenRouter paused; the correlation rule is intended, not current.
- AI health requires `progress.llmSucceeded > 0` (`src/lib/automation/health.ts`). `llm_allowance_exhausted` is not a failure skip. Completed / partial ≠ healthy AI. Radar 7d succeeded includes `success` and `partial` (`src/lib/radar.server.ts`).
- `DEFAULT_SCANNER_POLICY` is 60 minutes / 1 search (`src/lib/automation/settings.ts`). Spec correctly treats 2h / 3 searches as the **operating** baseline, not that default.
- Video inbox + `owner_attention_brief` + `GET /api/admin/video-review-brief` match #94 docs. Brief items exclude video IDs/URLs/report bodies.
- Export is 22 columns, hashes excluded (`src/app/api/admin/export/route.ts`). Session cookie `cd_admin`, 12h (`src/lib/session.ts`). Login `from=` allowlist includes `/operator` and `/admin/videos` (`src/lib/loginReturn.ts`).
- `setAutomationPaused` has no `AdminScannerView` caller. `/admin/source-monitor` redirects to `/scanner`.
- `#95` diagnostics are private allowlisted `progress.openRouterDiagnostics`. Spec does not dump them on Overview (correct).
- Awaiting = current-patch private-lead clusters without public signal or approved report (`src/lib/queries.ts`). Yield = kept/screened, not accuracy (`src/lib/observatoryMetrics.ts`).
- Dossier `?run=` unknown id omits output with no error (`src/app/admin/compile/page.tsx`). Spec’s “looks like no runs yet” is slightly strong: previous runs still list if any exist. Honesty gap is real.
- Circuit: 3 cost-unverified in 24h, or month money anomaly (`src/lib/automation/circuit.ts`).
- `safeRunSummary` strips raw `errors[]` (`src/lib/operatorOverview.ts`).
- 9:00 am Eastern aside does not call the brief (`OperatorOverview.tsx`). Connector is 10 AM `owner_attention_brief` (`docs/OWNER-ATTENTION-BRIEF.md`).

### Spec inaccuracies / gaps vs code

- **Claim-card reads are not reuse.** Intended fields (exact `fix_text`, official URL, cluster slug/category/description, sightings) are **not** on `AdminClusterRow` (`src/lib/adminClusters.ts` selects title, fix_status, override, reason, visibility, `is_public`). Exact official text is not stored on the cluster; today’s ledger shows `lifecycle_reason` prose. The pairing store is correctly “missing”; the spec still lists “Surface Needs review” as reuse. Slice B will need new reads, not just CSS on `readAdminClusters`.
- **Overview composition** of owner decisions is correctly “not a new store” but **is** new wiring: `src/app/operator/page.tsx` does not call `readReportReviewQueue`, `readAdminClusters` / `countNeedsYou`, or `readOwnerAttentionBrief`.
- **`getScannerAiHealth(admin?.control)`** works because `AutomationControlState` includes `paused` and `monthlyLlmUsdCap`. Overview still has **no** `llmPaused` / paused-integration list, so the Overview half of the AI+circuit correlation rule is mostly Scanner-only today. Spec implies Overview needs the same bundle.
- Test map cites `tests/e2e/public-visual.spec.ts` for operator destinations — that file **does** assert Overview / Report review / Videos after login. Fine.
- Historical `docs/PHASE-4-ADMIN-INVENTORY.md` is stale on Export (it was one-click; code now confirms). Spec followed **code**, not that inventory. Good. Spec also omits dead `runRedditMonitor` / unmounted `RejectedArchive` Rescue — correct (do not revive).
- Spec does not name `VisibilityOverrideBrowser` friction (2+ character search, cap 8, confirm checkbox is **action**-enforced not RPC-enforced). Dropping that browser, as the concept does, drops the only create path for force public/hidden (`PHASE-4` risk #15, still true in `src/components/admin/VisibilityOverrideBrowser.tsx`).
- Scanner policy form is a full JSON replace; splitting it resets cadence to 60 / unpauses (`settings.ts`). Spec says do not retune production cadence but does not carry this coupled-form hazard into surface-notes. Slice D risk, not Slice A visual — still a retained-capability footgun.

### Concept vs code

- IGDB sample state **Idle** is not a `CollectionHealthState` (`ok` / `disabled` / `unknown` / `no_capture` / `delayed` / `incomplete` / `unavailable` in `src/lib/collectionHealth.ts`). Spec: missing config is Disabled, not an incident. “Idle” collides with AI Idle.
- Concept skip target is `#main`. Operator shell main is `id="main-content"` (`src/components/dispatch/Chrome.tsx`). Implementation must not copy the concept id.
- Concept header is a single row; production is two-row nameplate + `OperatorNav`. Flagged as an owner visual call (`open-visual-decisions.md` #1). Fine if left open; not current code.

---

## Retained capabilities — silent drops

Anything still in code that Spec or Concept drops without saying so.

### Spec — generally retains; a few holes

| Capability | Code today | Spec | Drop? |
| --- | --- | --- | --- |
| Visibility force + Reset to automatic + `VisibilityOverrideBrowser` | `/admin` | Kept on Report review, break-glass | Named. Concept drops it. |
| Current patch override (no Clear) | `/admin` | Kept | Named. Concept drops it. |
| Video inbox #94 (add/save/approve/skip/archive/restore/download/brief) | `/admin/videos` | Stay on Videos; do not fold | Spec retains. Concept: one inert Overview row. |
| Scanner teach/undo, cadence/budget form, scans, collection, #95 | `/scanner` admin | Stay on Scanner; freeze 2h/3 | Spec retains. Concept: inert nav. |
| Dossiers + opt-in AI warning | `/admin/compile` | Stay | Spec retains. Concept: inert nav. |
| Export CSV 22-field + confirm | every operator page | Utilities register | Spec retains. Concept confirm is incomplete. |
| Overview run strip | `OperatorOverview` | Keep | Spec keeps. Concept drops. |
| Theme in nameplate, 12h footer, preview write notice | `OperatorShell` | Keep | Spec keeps. Concept drops footer, preview notice, 12h copy. |
| Anonymous Observatory on `/scanner` | `scanner/page.tsx` | Must keep | Spec retains. Concept does not touch public paths (correct Slice A). |
| `setAutomationPaused` duplicate UI | unwired | Do not revive | Explicit. Good. |
| `PublicScannerView` live path | already dead | Do not use | Explicit. Good. |
| `runRedditMonitor` / `RejectedArchive` Rescue | dead / unmounted | Unlisted | Correct omission. |

### Concept — silent drops on the Review desk that is supposed to replace `/admin`

The concept README scopes HTML to Overview + Report/Claim Review. That does **not** license dropping other controls that live **on those two routes today**.

Silent on Review (present on `src/app/admin/page.tsx`, retained in spec):

1. Visibility overrides list, Reset to automatic, and `VisibilityOverrideBrowser` (only create path for force public/hidden).
2. Current patch override (coupled to Scanner observation window and claim clocks).
3. Needs you parts copy as “N flagged · M pairings” on the Review headline (concept queue says “3 waiting · 3 in this tab” without the spec split).
4. Approve/excerpt honesty: production copy that excerpt insert can fail after approval (`approve-scope` on `/admin`). Concept says retry is safe.

Silent on Overview (present on `OperatorOverview.tsx`, retained in spec):

1. Run strip of latest authenticated runs.
2. Named unread registers (week / heartbeat / awaiting / published) as their own unknown cells.
3. Tool link to Videos (nav has it; footer tools in production are Scanner / Report review / Dossiers only — spec asked to **add** Videos; concept nav has Videos but Overview does not add a working Videos next step).
4. “Running quietly.” / “Status unavailable.” exact quiet/unknown copy.

Declared out of concept scope (OK if spec remains source of truth): Videos page, Scanner page, Dossiers page, 10 AM connector JSON.

---

## Privacy notes

- Concept sample reports, hardware, and the patch sentence are invented and labeled (“Invented sample · not production text”, rail “invented sample · in-memory only · no network”).
- No production exports, video IDs, source URLs, network hashes, Twitch/Steam identities, or `#95` diagnostic JSON in concept files or PNGs reviewed.
- No webfonts, `fetch`, or app routes in `concept.js` / `concept.css` / `index.html`.
- Official quote is labeled “sample citation, not fetched” — no Pearl Abyss screenshot (good).
- Spec restates public-output boundaries; no PII.
- Residual: invented private description/repro/hardware **is** in the git concept. That is acceptable if it stays labeled and never copied from prod. Do not replace it with real `/admin` dumps in a “make it feel real” pass.
- Concept Export copy correctly says a real export would include private descriptions and that this file never downloads.

---

## Owner-brief score (summary)

Full grid: `acceptance-checklist.md`.

| Criterion | Result |
| --- | --- |
| Attention → identifiable items | **Fail** on Overview; partial on Review queue |
| Reject durable across scans | **Spec only**; concept unverified |
| Lock not routine reject | **Partial** (not primary; still on the card with Marked fixed) |
| Desktop / mobile | **Partial** (core four states yes; unavailable/AI-blocked no) |
| Themes | **Partial** (same) |
| Empty / unavailable / AI-blocked / failed-save | Empty and report failed-save yes; unavailable/AI-blocked incomplete; pairing failed-save missing |
| Keyboard | **Unverified** beyond skip link / Enter / Confirm focus |
| Reduced motion | **Partial** (CSS present; no PNG; only `.chip` computed) |
| No app integration in Slice A | **Pass** (spec docs; concept `file://`; this review docs only) |

---

## What is actually good

Do not throw the work out. Independent review still credits:

- Spec’s handler inventory is the first accurate map of `/operator`, `/admin`, `/admin/videos`, `/scanner`, `/admin/compile`, and the brief since Phase 4. It traced Lock vs Needs you, Observatory anonymity, #94/#95, keyword re-flag, and unknown-vs-zero correctly.
- Spec correctly marks durable pairing as **missing** and forbids using Lock as “not this claim”.
- Concept shows the exact invented official sentence, keeps Lock off the primary row, distinguishes empty 0 from unavailable —, keeps a typed excerpt after failed-save, and does not hit the network.
- Frozen 2h / 3-search baseline, no Slice B–D code, no SQL in Slice A: both PRs honored that.

The gap is not effort. It is **two contracts**. Resolve the blocking list, then owner visual review can look at one desk instead of arbitrating Spec vs Concept in the browser.

---

*No fixes implemented. Spec and concept files untouched.*
