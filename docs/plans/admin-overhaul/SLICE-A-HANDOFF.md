# Slice A handoff

Integrator assembly of Spec (PR #96) + Concept (PR #97) plus this index, delivery map, and handoff. Independent review was **not** on the remote at assembly time.

## Baseline

| Ref | Value |
| --- | --- |
| Repo | `Statusnone420/Crimson-Desert-Report-Hub` |
| Base branch | `origin/main` |
| Base SHA | `2a0953a671ebed2cd5a09d147fd755be4458af4e` |
| Base tip | Merged PR #95 — *Record bounded scanner AI cost failure diagnostics* |
| Spec source | `cursor/slice-a-admin-spec-0b16` @ `cac22aab595af3f8dfccceee8f2fb686342b0ccc` (PR #96) |
| Concept source | `slice-a/admin-concept` @ `86a60863ab7f13463b4caf637ef3b025a3baad6a` (PR #97) |
| Integrator branch | `cursor/slice-a-admin-overhaul-5995` (requested name: `slice-a/admin-overhaul`) |
| Review source | **Absent.** `slice-a/admin-review` / `docs/plans/admin-overhaul/review/` not on remote. Fold in later or link a separate review PR. |

`git diff` of `spec/` vs the spec branch and `concept/` vs the concept branch was empty at assembly. Paths did not overlap. No third design was written into those trees.

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

Exclusive integrator writes:

- `docs/plans/admin-overhaul/README.md`
- `docs/plans/admin-overhaul/delivery-map.md`
- `docs/plans/admin-overhaul/SLICE-A-HANDOFF.md`

Nothing outside `docs/plans/admin-overhaul/`. No application code, migrations, package files, or `admin/redesign-plan`.

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

Extra (light only): `desktop-light-overview-unavailable.png`, `desktop-light-overview-ai-blocked.png`, `mobile-light-review-queue.png`.

## Short design account

Operate mode: **quick check** (Overview) then **focused session** (one Review item). The public newspaper remains the quality bar for type, contrast, and honesty — not a template for article-length operator spacing.

Overview separates work that needs a person from informational health and inventory. The attention numeral must name what it counts (flagged reports and claim pairings in the concept). Approved/spam totals and “completed with limits” are not chores. Unavailable is an em dash, never a green zero.

Report/Claim Review is a scannable queue plus one item’s full form. A claim match shows the **exact official patch-note sentence**, source, patch, and issue context. Routine actions (spec names): **Confirm pairing**, **Not the same issue**, **Decide later**. None of these certifies that the game is fixed. **Lock** is an exceptional issue-wide override, not the reject control.

Concept data is invented and labeled. Decisions are in-memory only. Videos, Scanner, and Dossiers are specified in `spec/` but not concepted as HTML.

## Checks actually run vs gaps

### Integrator (this assembly)

| Check | Result |
| --- | --- |
| `origin/main` tip includes #95 / `2a0953a` | Yes |
| Copy `spec/` from `cac22aa`; copy `concept/` from `86a6086` | Trees identical to sources (`git diff` empty) |
| Path overlap / conflict | None |
| `slice-a/admin-review` | Missing on remote — placeholder only |
| `npm run lint` / `npm test` / `tsc` / `npm run build` / e2e | **Not run** (docs + static concept only; no application change) |
| Scanner bake-off, migrations, paid provider, production | **Not run** (forbidden) |
| Re-open concept in a browser on this branch | **Not re-run**; evidence remains Agent 2’s `concept/VERIFICATION.md` and PNGs |

CI on this PR will still execute the repository workflow (lint, unit, tsc, build, Playwright) because every pull request does. That is not extra proof of the concept HTML.

### Spec PR #96 (as reported there)

Read-only tracing of OperatorOverview, AdminScannerView, `admin/actions`, reportReview, claimMapping, lifecycle, health.ts, ownerAttentionBrief, radar.server, observatoryMetrics, videoReviewStore, and the tests named in the inventory. No scanner runs, migrations, paid calls, or production access. App lint/test/build skipped (docs only).

### Concept PR #97 (as reported in `concept/VERIFICATION.md`)

- Chromium/Playwright `file://` screenshots at 1440×1100 and 390×844, both themes, for required key states.
- 320px Overview/Review: no document horizontal overflow in the sampled set.
- 720px used as a 200%-of-1440 stand-in: no document overflow.
- Keyboard: skip link, Tab into nav/controls, queue Enter, Confirm focusable. Full claim-form Tab, reverse Tab, SR, Escape-to-close export **not** timed.
- `prefers-reduced-motion: reduce`: transition `0s`, animation `none`.
- Failed-save keeps typed excerpt; Confirm keeps the queue row (in-memory).
- Firefox, Safari, physical phone, and a contrast meter were **not** used.
- System fonts, not Instrument Serif/Sans.

## Gaps

- **Independent review** not folded in.
- **Videos / Scanner / Dossiers** have spec notes, not interactive concepts.
- **Pairing backend missing** — Confirm / Not the same issue / Decide later / durable suppression are specified, not implemented.
- **Reject reason** required by spec; concept UI has no reason field.
- **Overview owner-decision reads** exist in code today but are not shown on `/operator`; the concept is a proposal.
- **Dossier missing-`?run=` honesty** flagged in the inventory; not in the HTML concept.
- Concept **Approve retry** succeeds in memory and does not demonstrate today’s Approve-then-excerpt split (approval can commit while excerpt insert fails).
- Concept **history/undo ledger** for pairings is not drawn (spec wants list + undo on `/admin`).
- Rolling-deploy pairing/brief disagreement cannot be shown in static HTML.

## Spec vs concept contradictions (prefer spec for behavior)

Do not invent a third label set. Owner still chooses visual chrome (see visual list below).

| Topic | Spec | Concept | Integrator call |
| --- | --- | --- | --- |
| Reject control | **Not the same issue** + required 3–500 char reason | Button **Not the same**; no reason field | Prefer spec. Reason is behavior, not decoration. |
| Confirm control | **Confirm pairing** — this official line is about this issue; engine-owned `fix_claimed`; not game-fixed | **Confirm this is the same** | Prefer spec meaning and name in implementation copy. Compact visual wording is an owner visual call, not a new contract. |
| Overview families | **Owner decisions** vs **operational incidents** vs **background inventory** | **Do now** vs **Informational** | Prefer spec for what may enter which list. “Do now” may stay as chrome if the contents match the spec families. |
| Attention numeral | Named items: flagged reports, pending pairings, video pending, video drafts (owner row). AI is operational. | Numeral = reports + claim matches; Videos and AI-blocked are extra Do-now **rows** | Prefer spec: do not mix AI into the Review count; keep Videos named and separate. Concept already asks this as visual decision 3. |
| Nav labels | Overview, **Report review**, Videos, **Scanner monitor**, Dossiers | Overview, **Review**, Videos, **Scanner**, Dossiers | Prefer spec destination names. |
| Quiet Overview | “Running quietly.” only when both families are known empty | “No decisions waiting” / “Nothing needs a decision.” | Prefer spec quiet copy if both rows are known empty; concept inventory column may stay visible. |
| Lock | Exceptional / break-glass; not the first button on a keyword flag | Dashed disclosure under match actions | Intent aligned. Whether Lock belongs on the claim desk at all is visual decision 6. |
| Decide later | Still one Needs-you item; no expiry; later `llm_sure` may auto-confirm (open decision 3) | Leaves the row in the queue; in-memory only | Aligned as a demo. Auto-sure is an owner data call, not something the HTML can prove. |
| Keep decided row | History UI + undo; queue need not keep a decided card | Decided items stay in the queue marked “Kept in queue” | Visual/UX, not a write-contract clash. Do not drop spec undo/history to match the demo. |

## Owner decisions

Merged from [`spec/open-decisions.md`](spec/open-decisions.md) and [`concept/open-visual-decisions.md`](concept/open-visual-decisions.md). Short list only. Spec recommendations stay in those files.

### Data / contract (answer before Slice B pairing writes)

1. **Confirm onto a different cluster in one step?** Spec recommendation: **No for v1.** Wrong cluster → Not the same issue (reason), or exceptional Lock.
2. **Map official claims onto non-public clusters?** Spec recommendation: **No.** Keep `is_public = true` so Confirm cannot start a public claim clock on an unpublished issue.
3. **Should Decide later block a later `llm_sure`?** Spec recommendation: **Keep auto-sure on Later** (defer, not a verdict). Flip only if Later should freeze the pairing even when the model becomes sure.

### Visual / chrome (answer before Slice B/C UI)

4. **Nav placement.** Concept: compact single-row header. Alternative: today’s two-row nameplate.
5. **Typography scale.** Concept: ~22px sans Overview title; serif reserved for the official quote and small wordmark. Not 80px newspaper headlines.
6. **Attention numeral composition.** Reports + claim matches in the numeral; Videos and AI-blocked as extra rows (concept). Spec wants AI in the operational family and videos named separately — see contradiction table.
7. **Review split.** Desktop ~268px queue + detail; mobile queue *then* item; 880px breakpoint. Do-now jump lands on the first item; header Review on a phone lands on the queue.
8. **Claim quote treatment.** Left-ruled serif pull quote of the exact sentence. No Pearl Abyss screenshot in the concept; implementation may add the existing section illustration **without replacing the sentence**.
9. **Lock on the claim desk?** Concept: dashed disclosure. If Lock should be completely off this desk (Scanner/break-glass only), say so before Slice B.
10. **Theme default.** Light primary; dark first-class. Concept does not persist `localStorage` so it cannot collide with the newspaper theme key.
11. **Wordmark.** Small serif “Crimson Desert *Report Hub*” + operator kicker, vs “Operator” only.

### Already assumed in Slice A (reversible; not owner-blocking)

Confirm = engine-owned `fix_claimed`; Reject suppresses that pairing including later `llm_sure`; Later stays one Needs-you item with no expiry; Lock stays exceptional; AI+circuit co-symptoms count once; Overview gains named owner-decision **reads** without writes; public `/scanner` Observatory unchanged; 2h / 3 searches frozen; no card grid / glass / decorative shadow; 4px radius on controls; amber focus on operator chrome; concept system fonts, Instrument fonts in the app; in-memory demo rail is not product chrome.

## WIP PRs

- [#96](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/96) and [#97](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/97) are **superseded by this integrator PR**. Leave them open; do not merge or close them from this work.
- Independent review, when filed, should be folded into this folder or linked from this handoff.

## What “done” means for Slice A

Owner can review behavior (spec) and visual (concept) in **one** draft PR, with a single decision list and an explicit stop before B–D. This handoff does not implement the redesign.
