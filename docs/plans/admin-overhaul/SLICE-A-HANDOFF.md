# Slice A handoff

Integrator assembly of Spec (PR #96) + Concept (PR #97) + Independent review (PR #99) plus this index, delivery map, and handoff.

**Independent review verdict: NEEDS FIXES.** Spec and concept were not rewritten in this pass. Blocking issues are listed below for the owner.

## Baseline

| Ref | Value |
| --- | --- |
| Repo | `Statusnone420/Crimson-Desert-Report-Hub` |
| Base branch | `origin/main` |
| Base SHA | `2a0953a671ebed2cd5a09d147fd755be4458af4e` |
| Base tip | Merged PR #95 — *Record bounded scanner AI cost failure diagnostics* |
| Spec source | `cursor/slice-a-admin-spec-0b16` @ `cac22aab595af3f8dfccceee8f2fb686342b0ccc` (PR #96) |
| Concept source | `slice-a/admin-concept` @ `86a60863ab7f13463b4caf637ef3b025a3baad6a` (PR #97) |
| Review source | `slice-a/admin-review` @ `e348b471a68c7eb75cea0a990b78dd4d12c193f5` (PR #99) |
| Integrator branch | `cursor/slice-a-admin-overhaul-5995` (requested name: `slice-a/admin-overhaul`) |

`git diff` of `spec/` vs the spec branch, `concept/` vs the concept branch, and `review/` vs the review branch was empty at fold-in. Paths did not overlap. No third design was written into those trees.

---

## Independent review — NEEDS FIXES

Source: [`review/findings.md`](review/findings.md) and [`review/acceptance-checklist.md`](review/acceptance-checklist.md). Copied from #99; not softened.

An owner looking at the HTML would approve a different product than Slice B would implement from the spec. Owner visual/behavior review of **one** desk should wait until these are resolved **or** the owner explicitly accepts the mismatches.

### 1. Overview attention count vs identifiable items

The owner brief and spec require that an attention count expand to **named identities** (at least: N flagged reports, M pairings, video pending, video drafts), each with a next step. A bare “3 checks to review” is a failed readout.

The concept does not do that on Overview:

- The **numeral** is flagged reports + claim matches only (`reviewChoreCount`). Caption example: “2 reports · 1 claim · not inventory”.
- The **list** is one aggregated **“Review queue”** blob (“2 flagged reports and 1 unsure claim match”) plus a Video row, and when AI-blocked an AI-mapping row as well.
- AI also appears again under Informational. Spec puts AI in the **operational** family, not the Review count.

Result: numeral, list, and spec families are three different products. Review queue titles on the Review desk are identifiable; Overview is not. Checklist: **Fail** (Overview), **Partial** (Review).

### 2. Not-the-same missing required reason; durability demo limits

Spec: **Not the same issue** requires a 3–500 character reason, then durable suppression of that `pairingKey` across later scans (including later `llm_sure` until Undo).

Concept: button **Not the same**, no reason field, no undo, in-memory only. Changing the situation switcher wipes `decisions`. There is no “scan again” fixture.

Slice A cannot show “reject keeps out of pending across scans.” That acceptance line lives in the spec only (missing backend). Combined visual: **Unverified**. Do not treat the in-memory demo as production pending arithmetic.

### 3. Lock still on the claim card

Spec replaces Lock as the routine response to a pairing. The pairing card must not offer a “game is fixed” control. Lock remains exceptional `setClusterFixStatus` (Open / Fix claimed — unverified / Marked fixed by maintainer / Still happening).

Concept: primary buttons are Confirm / Not the same / Decide later (good). Lock is still a dashed disclosure **on the same claim card**, including **Marked fixed by maintainer**. The committed claim PNG shows only the collapsed summary.

Both `spec/open-decisions.md` and `concept/open-visual-decisions.md` leave “Lock on this desk?” open. It is **not decided**. Checklist: **Partial**.

### 4. Visibility + current-patch overrides dropped from the concept

Those controls live on today’s `/admin` (`src/app/admin/page.tsx`) and the spec **keeps** them on Report review as break-glass (visibility force + Reset; current-patch override; `VisibilityOverrideBrowser` is the only create path for force public/hidden).

The concept Review desk omits both. Scoping HTML to Overview + Claim Review does not license dropping other controls that already live on those routes. Checklist C11: spec **Pass**, concept **Fail** (silent drop). Restore them on the Review concept, or defer them **in writing** before Slice B.

### 5. Evidence gaps (unavailable / AI-blocked coverage, overflow claim)

Owner asked desktop and mobile, both themes, empty / unavailable / AI-blocked / failed-save, keyboard, reduced motion.

Committed PNGs cover both themes × both viewports only for: Overview normal, Overview empty, Review claim, Review **report** failed-save.

Missing from the matrix (review #99):

- Overview unavailable / AI-blocked: **desktop-light extras only** — no mobile, no dark
- Review AI-blocked, Review unavailable, Review empty: **no PNG**
- Pairing failed-save / stale revision: **no PNG**
- Reduced-motion PNG, post-decision queue, open Lock disclosure: **none**
- `VERIFICATION.md` claims 320px Review-detail overflow delta 0; the capture script’s pass bar is `<= 8px`. Capture log is not in the PR. Treat the 0px claim as **unverified**.

Keyboard beyond skip link / queue Enter / Confirm focus: not run. Theme toggle is **40×40px** vs the 44px floor.

---

Non-blocking items the owner should still not ignore (full text in findings): nav labels; video row “publication decision” vs #94 private later-PR draft; Export confirm with no Download CSV; missing Overview run strip and 12-hour footer; spec test bullet “Later does not increment Needs you” vs the contract that Later still counts as one pending item.

What the review still credits: spec handler inventory; pairing marked missing; concept exact invented official sentence; empty 0 vs unavailable —; typed excerpt kept after report failed-save; no network; 2h / 3 searches frozen.

## Files changed (this PR)

Copied from #96 (`spec/`):

- `docs/plans/admin-overhaul/spec/capability-inventory.md`
- `docs/plans/admin-overhaul/spec/metrics-attention-contract.md`
- `docs/plans/admin-overhaul/spec/claim-review-contract.md`
- `docs/plans/admin-overhaul/spec/surface-notes.md`
- `docs/plans/admin-overhaul/spec/open-decisions.md`

Copied from #97 (`concept/`):

- `docs/plans/admin-overhaul/concept/index.html`
- `docs/plans/admin-overhaul/concept/concept.css`
- `docs/plans/admin-overhaul/concept/concept.js`
- `docs/plans/admin-overhaul/concept/README.md`
- `docs/plans/admin-overhaul/concept/VERIFICATION.md`
- `docs/plans/admin-overhaul/concept/open-visual-decisions.md`
- `docs/plans/admin-overhaul/concept/capture-screenshots.cjs`
- `docs/plans/admin-overhaul/concept/screenshots/*.png` (19 PNGs)

Copied from #99 (`review/`):

- `docs/plans/admin-overhaul/review/findings.md`
- `docs/plans/admin-overhaul/review/acceptance-checklist.md`

Exclusive integrator writes:

- `docs/plans/admin-overhaul/README.md`
- `docs/plans/admin-overhaul/delivery-map.md`
- `docs/plans/admin-overhaul/SLICE-A-HANDOFF.md`

Nothing outside `docs/plans/admin-overhaul/`. No application code, migrations, package files, or `admin/redesign-plan`. Spec and concept trees were not edited to “fix” review findings.

## How to open the concept

See [`README.md`](README.md) and [`concept/README.md`](concept/README.md). Open `concept/index.html` as a local file. Invented-sample labeling must remain visible on the rail.

## Visual screenshot paths

Under `docs/plans/admin-overhaul/concept/screenshots/`. These are concept renders of invented states, not production admin captures.

| State | Desktop 1440×1100 | Mobile 390×844 |
| --- | --- | --- |
| Overview · normal | `desktop-light-overview-normal.png`, `desktop-dark-overview-normal.png` | `mobile-light-overview-normal.png`, `mobile-dark-overview-normal.png` |
| Review · claim match | `desktop-light-review-claim.png`, `desktop-dark-review-claim.png` | `mobile-light-review-claim.png`, `mobile-dark-review-claim.png` |
| Overview · empty | `desktop-light-overview-empty.png`, `desktop-dark-overview-empty.png` | `mobile-light-overview-empty.png`, `mobile-dark-overview-empty.png` |
| Review · failed-save | `desktop-light-review-failed-save.png`, `desktop-dark-review-failed-save.png` | `mobile-light-review-failed-save.png`, `mobile-dark-review-failed-save.png` |

Extra (light only): `desktop-light-overview-unavailable.png`, `desktop-light-overview-ai-blocked.png`, `mobile-light-review-queue.png`. Review #99 treats that extra set as incomplete coverage of the owner matrix.

## Short design account

Operate mode: **quick check** (Overview) then **focused session** (one Review item). The public newspaper remains the quality bar for type, contrast, and honesty — not a template for article-length operator spacing.

Overview is specified as two named families (owner decisions vs operational incidents). The concept draws Do now vs Informational; review #99 says those are not yet the same contract (see blocking item 1).

Report/Claim Review is specified as a scannable queue plus one item’s full form, with the **exact official patch-note sentence**, then **Confirm pairing**, **Not the same issue** (reason required), **Decide later**. None of these certifies that the game is fixed. **Lock** is exceptional. The concept shows the sentence and the three primary buttons; it still mounts Lock on the card and omits the reject reason (blocking items 2–3).

Concept data is invented and labeled. Decisions are in-memory only. Videos, Scanner, and Dossiers are specified in `spec/` but not concepted as HTML.

## Checks actually run vs gaps

### Integrator (this assembly)

| Check | Result |
| --- | --- |
| `origin/main` tip includes #95 / `2a0953a` | Yes |
| Copy `spec/` from `cac22aa`; `concept/` from `86a6086`; `review/` from `e348b47` | Trees identical to sources (`git diff` empty) |
| Path overlap / conflict | None |
| Spec/concept rewritten to satisfy review | **No** (index/handoff/delivery-map only) |
| `npm run lint` / `npm test` / `tsc` / `npm run build` / e2e | **Not run** (docs + static concept only; no application change) |
| Scanner bake-off, migrations, paid provider, production | **Not run** (forbidden) |
| Re-open concept in a browser on this branch | **Not re-run**; evidence remains Agent 2’s `concept/VERIFICATION.md` and PNGs, plus Agent 3’s read of those files |

CI on this PR will still execute the repository workflow because every pull request does. That is not extra proof of the concept HTML.

### Spec PR #96 (as reported there)

Read-only tracing of OperatorOverview, AdminScannerView, `admin/actions`, reportReview, claimMapping, lifecycle, health.ts, ownerAttentionBrief, radar.server, observatoryMetrics, videoReviewStore, and the tests named in the inventory. No scanner runs, migrations, paid calls, or production access. App lint/test/build skipped (docs only).

### Concept PR #97 (as reported in `concept/VERIFICATION.md`)

- Chromium/Playwright `file://` screenshots at 1440×1100 and 390×844, both themes, for the core four states.
- 320px / 720px overflow claims — review #99 flags the 320px Review-detail 0px claim as unverified (script pass bar `<= 8`).
- Keyboard: skip link, Tab into nav/controls, queue Enter, Confirm focusable. Full claim-form Tab, reverse Tab, SR, Escape-to-close export **not** timed.
- `prefers-reduced-motion: reduce`: transition `0s`, animation `none` (no PNG).
- Failed-save keeps typed excerpt; Confirm keeps the queue row (in-memory).
- Firefox, Safari, physical phone, and a contrast meter were **not** used.
- System fonts, not Instrument Serif/Sans.

### Review PR #99 (as reported there)

Read-only trace of the same handlers plus `admin/page`, scanner Observatory path, and committed concept HTML/CSS/JS/PNGs. Playwright was not re-run (no Playwright package in that environment). No scanner runs, migrations, or production access.

## Gaps

- **Review verdict NEEDS FIXES** — five blocking items above; spec/concept not aligned in this pass.
- **Videos / Scanner / Dossiers** have spec notes, not interactive concepts.
- **Pairing backend missing** — Confirm / Not the same issue / Decide later / durable suppression are specified, not implemented.
- Concept **Approve retry** succeeds in memory and does not demonstrate today’s Approve-then-excerpt split.
- Concept **history/undo ledger** for pairings is not drawn.
- Rolling-deploy pairing/brief disagreement cannot be shown in static HTML.

## Spec vs concept contradictions (prefer spec for behavior)

Do not invent a third label set. Owner still chooses visual chrome. Review #99 is the full table; this is the short list.

| Topic | Spec | Concept | Integrator call |
| --- | --- | --- | --- |
| Reject control | **Not the same issue** + required 3–500 char reason | Button **Not the same**; no reason field | Prefer spec. Reason is behavior. **Blocking.** |
| Confirm control | **Confirm pairing** — this official line is about this issue; engine-owned `fix_claimed`; not game-fixed | **Confirm this is the same** | Prefer spec meaning and name in implementation copy. |
| Overview families | **Owner decisions** vs **operational incidents** vs **background inventory** | **Do now** vs **Informational** | Prefer spec for what may enter which list. **Blocking** until arithmetic matches identities. |
| Attention numeral | Named items; AI is operational | Numeral = reports + claims; Videos and AI-blocked as extra Do-now rows | Prefer spec. **Blocking.** |
| Identifiable items | Forbids a blob count | Overview “Review queue” aggregates reports + pairings | Prefer spec. **Blocking.** |
| Nav labels | Overview, **Report review**, Videos, **Scanner monitor**, Dossiers | Overview, **Review**, Videos, **Scanner**, Dossiers | Prefer spec destination names. |
| Quiet Overview | “Running quietly.” only when both families are known empty | “No decisions waiting” / “Nothing needs a decision.” | Prefer spec quiet copy if both rows are known empty. |
| Lock | Exceptional / break-glass; no “game is fixed” on the pairing card | Dashed disclosure on the claim card, including Marked fixed | Prefer spec. **Blocking** until owner places Lock. |
| `/admin` break-glass | Visibility + current-patch stay on Report review | Omitted | Prefer spec. Restore or defer in writing. **Blocking.** |
| Decide later | Still one Needs-you item; no expiry; later `llm_sure` may auto-confirm (open decision 3) | Leaves the row in the queue; in-memory only | Aligned as a demo only. Auto-sure is an owner data call. |
| Keep decided row | History UI + undo | Decided items stay marked “Kept in queue” | Do not drop spec undo/history to match the demo. |

## Owner decisions

Merged from [`spec/open-decisions.md`](spec/open-decisions.md) and [`concept/open-visual-decisions.md`](concept/open-visual-decisions.md), plus review #99 items that need an owner call rather than a silent third design.

### Data / contract (answer before Slice B pairing writes)

1. **Confirm onto a different cluster in one step?** Spec recommendation: **No for v1.** Wrong cluster → Not the same issue (reason), or exceptional Lock.
2. **Map official claims onto non-public clusters?** Spec recommendation: **No.** Keep `is_public = true` so Confirm cannot start a public claim clock on an unpublished issue.
3. **Should Decide later block a later `llm_sure`?** Spec recommendation: **Keep auto-sure on Later** (defer, not a verdict). Flip only if Later should freeze the pairing even when the model becomes sure.

### Blocking review items (accept as-is, or send back for a concept/spec pass)

4. **Overview attention arithmetic and identifiable items.** Spec two families + named identities, or concept Do now blob + mixed Video/AI rows? Review says pick one; do not ship both.
5. **Not the same issue reason + durability.** Keep the spec’s required reason (integrator preference), or change the spec to match the concept.
6. **Lock on the claim card?** Including “Marked fixed by maintainer”. Spec forbids a game-fixed control on the pairing card; concept already placed Lock there.
7. **Visibility + current-patch overrides on Review.** Restore on the concept, or written deferral that Slice B still ships them on `/admin`.
8. **Evidence matrix.** Accept desktop-light-only unavailable/AI-blocked plus unverified 320px overflow, or require the missing PNGs before visual sign-off.

### Visual / chrome (answer before Slice B/C UI)

9. **Nav placement.** Concept: compact single-row header. Alternative: today’s two-row nameplate.
10. **Typography scale.** Concept: ~22px sans Overview title; serif reserved for the official quote and small wordmark.
11. **Review split.** Desktop ~268px queue + detail; mobile queue *then* item; 880px breakpoint. Do-now jump lands on the first item; header Review on a phone lands on the queue.
12. **Claim quote treatment.** Left-ruled serif pull quote of the exact sentence. Implementation may add the existing section illustration **without replacing the sentence**.
13. **Theme default.** Light primary; dark first-class. Concept does not persist `localStorage`.
14. **Wordmark.** Small serif “Crimson Desert *Report Hub*” + operator kicker, vs “Operator” only.

### Already assumed in Slice A (reversible; not owner-blocking)

Confirm = engine-owned `fix_claimed`; Reject suppresses that pairing including later `llm_sure`; Later stays one Needs-you item with no expiry; AI+circuit co-symptoms count once; Overview gains named owner-decision **reads** without writes; public `/scanner` Observatory unchanged; 2h / 3 searches frozen; no card grid / glass / decorative shadow; 4px radius on controls; amber focus on operator chrome; concept system fonts, Instrument fonts in the app; in-memory demo rail is not product chrome.

## WIP PRs

- [#96](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/96), [#97](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/97), and [#99](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/99) are **superseded by this integrator PR**. Leave them open; do not merge or close them from this work.

## What “done” means for Slice A

Owner has **one** draft PR containing spec, concept, independent review, index, delivery map, and this handoff. Review says that package **NEEDS FIXES** before it is one contract. This handoff does not implement the redesign and does not authorize Slices B–D.
