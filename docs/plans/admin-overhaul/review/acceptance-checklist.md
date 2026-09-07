# Slice A acceptance checklist

Independent check of Spec PR #96 and Concept PR #97 against the owner brief and `origin/main` @ `2a0953a`. Not a sign-off. Spec/concept were not edited.

Legend: **Pass** / **Fail** / **Partial** / **Unverified**. Evidence is what this review actually saw (code, committed PNGs, source). Claims only in `VERIFICATION.md` without a PNG or re-run are Unverified.

---

## Owner brief

| # | Criterion | Spec | Concept | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Attention expands to **identifiable items** | Requires named owner decisions (flagged reports, pairings, video pending, video drafts) and named operational incidents. Forbids a bare “3 checks to review”. | Overview Do now numeral is `2 reports · 1 claim`. The list is one aggregated “Review queue” row plus a Video row. No report titles, no pairing identity, no video-draft count. Review queue **does** name three sample items. | `metrics-attention-contract.md` §4; `concept.js` `overviewModel` / `reviewChoreCount`; `screenshots/desktop-light-overview-normal.png`; `screenshots/mobile-light-review-queue.png` | **Fail** (Overview). **Partial** (Review). |
| 2 | Reject pairing **durable across scans** | Confirm/Reject/Later store; identical `pairingKey` suppressed after Reject, including later `llm_sure` until Undo. Rolling-deploy: missing store ≠ All clear. | In-memory only. `applyScenario` clears `decisions`. No second-scan fixture. “Not the same” has no required reason. | `claim-review-contract.md` §Repeat-scan; `concept.js` `applyScenario` / `decide` | Spec: **Pass** (specified). Concept: **Fail** (cannot demonstrate). Combined: **Unverified** in Slice A visuals. |
| 3 | **Lock** is not the routine reject | Replaces Lock as routine response. Lock remains exceptional `setClusterFixStatus`. Confirm ≠ marked fixed. | Primary buttons are Confirm / Not the same / Decide later. Lock is a disclosure on the **same** card, including “Marked fixed by maintainer”. | `claim-review-contract.md` §Lock and §What the operator must see; `concept.js` `renderClaim`; `desktop-light-review-claim.png` (summary only; options not in PNG) | **Partial** |
| 4 | Desktop **and** mobile | Surface-notes: first task in first 1440 viewport; mobile not specified beyond 44px. | 1440×1100 and 390×844 PNGs for normal / empty / claim / report-failed-save, both themes. 880px queue-then-detail. Sticky mobile actions. | `screenshots/*`; `concept.css` `@media (max-width: 880px)` | **Partial** — core frames yes; unavailable/AI-blocked not in the viewport matrix |
| 5 | Light **and** dark | Operator amber, both palettes; light default; paper `#f6f4ee`. | Both themes in CSS and in the core PNG set. Dark paper `#000`, amber `#dcad57`. Does not persist `localStorage`. | `concept.css` `:root` / `html[data-theme="dark"]`; `desktop-dark-overview-normal.png` | **Partial** — same matrix gap as #4 |
| 6 | Empty | Quiet only when both lists known empty; zeros only from successful reads. | Empty Overview: Do now 0, “Nothing needs a decision”, Informational still populated (deliberate). Review empty copy exists in JS; **no empty Review PNG**. | `desktop-light-overview-empty.png`; `concept.js` `scenario === "empty"` | **Partial** |
| 7 | Unavailable | `—` / Status unavailable; never a green zero. Brief/video schema missing → unavailable. | Overview unavailable: “Status unavailable”, count `—`, named missing reads. Review: “Queue unavailable”. Only **desktop-light** Overview PNG. CTA “Open Review anyway →” fights the spec. | `desktop-light-overview-unavailable.png`; `concept.js` `unknown` | **Partial** |
| 8 | AI-blocked | Completed run ≠ healthy AI; keyword proposal still shows exact notes; AI+circuit once if co-symptomatic. | Overview AI-blocked: Do now “AI mapping blocked” **and** Informational “Blocked”; numeral still 3 (reports+claims). No Review AI-blocked PNG (keyword banner exists in JS). No circuit fixture. | `desktop-light-overview-ai-blocked.png`; `concept.js` `whyKeyword` | **Partial** |
| 9 | Failed-save | Keep pairing/report + error. Do not hide Approve-already-committed excerpt failure. | Report failed-save PNG both themes × both viewports. Excerpt kept; retry Approve succeeds and advances (demo). No pairing failed-save. Does not show production excerpt-after-approve throw. | `desktop-light-review-failed-save.png`; `src/app/admin/actions.ts` `moderateReport` | **Partial** |
| 10 | Keyboard | Inventory controls remain reachable; 44px; Export Escape + focus return. | Skip link, 44px nav/actions (theme toggle **40px**). `VERIFICATION.md` Tab sample never reached Do-now. Export Escape implemented without focus return. Claim-form Tab / SR: not run. | `concept.css` `.theme-toggle`; `concept.js` `keydown`; `VERIFICATION.md` Keyboard | **Unverified** (admitted gaps) / **Fail** on 44px toggle and Export focus |
| 11 | Reduced motion | DESIGN.md: no animation/transition. | `@media (prefers-reduced-motion: reduce)` zeros animation/transition. Only `.chip` computed in VERIFICATION. No PNG. | `concept.css` last media block; `VERIFICATION.md` Reduced motion | **Partial** |
| 12 | No app integration in Slice A | Docs only; no SQL; freeze cadence/budgets/models/circuit. | Static `index.html` + CSS + JS. No fetch/webfonts. Capture script is local Chromium, not Next. | Spec file list; `concept/index.html`; grep of concept sources | **Pass** |

---

## Current code (`main`) that Spec + Concept must not break

| # | Check | Spec | Concept | Code | Result |
| --- | --- | --- | --- | --- | --- |
| C1 | Anonymous `/scanner` = public Observatory | Explicit must-keep | Not in HTML (out of concept scope) | `src/app/scanner/page.tsx` `if (!admin) return <ObservatoryPage />` | Spec **Pass**. Concept n/a (must remain spec-binding). |
| C2 | `/observatory` stays | Yes | n/a | `src/app/observatory/page.tsx` | **Pass** |
| C3 | Needs you ≠ inventory; locks not required work | Yes | Review mixes chores in one queue; Overview keeps approved/spam informational | `src/lib/reportReview.ts` `countNeedsYou` | Spec **Pass**. Concept Overview **Partial**. |
| C4 | Keyword `Needs review:` re-flags every scan | Problem statement + durable store | No second scan | `src/lib/lifecycle.ts`; `src/lib/automation/run.ts` `writeLifecycleResult` | Spec **Pass**. Concept **Unverified**. |
| C5 | Lock ≠ confirm pairing; Clear lock unchanged | Yes | Lock still on claim card | `src/app/admin/actions.ts` `setClusterFixStatus` / `clearClusterFixStatusOverride` | Spec **Pass**. Concept **Partial**. |
| C6 | #94 video inbox + brief privacy | Full inventory on `/admin/videos` | Inert nav + “publication decision” copy | `src/app/admin/videos/*`; `src/lib/ownerAttentionBrief.ts`; `docs/OWNER-ATTENTION-BRIEF.md` | Spec **Pass**. Concept **Fail** (copy) / **Unverified** (surface). |
| C7 | #95 diagnostics private, not attention items | Yes; Overview must not dump JSON | Not shown | `src/lib/automation/health.ts`; diagnostics tests | Spec **Pass**. Concept n/a. |
| C8 | `owner_attention_brief` keys stay; missing schema ≠ empty | Yes; later RPC body change | Not shown | `supabase/migrations/20260907030544_video_review_inbox.sql` | Spec **Pass**. |
| C9 | Completed / partial ≠ AI healthy | Yes | Informational “completed with limits” not a chore (good); AI-blocked still in Do now | `OperatorOverview.tsx`; `AdminScannerView.tsx` | Spec **Pass**. Concept **Partial**. |
| C10 | 2h cadence / 3 searches frozen | Explicit | Not on these two desks | `src/lib/automation/settings.ts` options 60/120/360/1440 and 1–3 | **Pass** (not changed in Slice A) |
| C11 | Visibility + patch override remain | Spec keeps on Report review | **Omitted** from Review HTML | `src/app/admin/page.tsx` visibility ledger + patch `<details>` | Spec **Pass**. Concept **Fail** (silent drop). |
| C12 | Export 22-field private confirm | Yes | Confirm without Download CSV | `src/components/dispatch/OperatorNav.tsx`; `src/app/api/admin/export/route.ts` | Spec **Pass**. Concept **Fail**. |
| C13 | Public output: no raw reports / hashes / rejected URLs / video IDs | Restated | Invented samples labeled | Concept sources + PNGs | **Pass** (privacy) |

---

## Spec ↔ Concept contract (must be one story)

| # | Item | Aligned? |
| --- | --- | --- |
| S1 | Metric labels (Do now vs owner decisions vs Checks to review) | **No** |
| S2 | Claim action names and required reject reason | **No** |
| S3 | Lock placement | **No** (open in both PRs; concept already placed it on the card) |
| S4 | Overview family split (owner vs operational vs inventory) | **No** |
| S5 | Exact official claim text on the pairing card | **Yes** (concept shows invented verbatim sentence) |
| S6 | Empty 0 vs unavailable — | **Yes** (Overview) |
| S7 | Videos stay a separate destination | **Yes** (nav); **No** (Overview video copy / numeral) |
| S8 | Confirm does not certify the game is fixed | **Yes** in copy; **No** if Lock/Marked fixed stays on the card |
| S9 | Quiet copy | **No** (“Running quietly.” vs “No decisions waiting.”) |
| S10 | Later vs Needs you | Spec disagrees with itself; concept just leaves the item pending |

---

## Evidence files (concept)

Present under `docs/plans/admin-overhaul/concept/screenshots/` on `slice-a/admin-concept`:

- `desktop-{light,dark}-overview-normal.png`
- `desktop-{light,dark}-overview-empty.png`
- `desktop-{light,dark}-review-claim.png`
- `desktop-{light,dark}-review-failed-save.png`
- `mobile-{light,dark}-overview-normal.png`
- `mobile-{light,dark}-overview-empty.png`
- `mobile-{light,dark}-review-claim.png`
- `mobile-{light,dark}-review-failed-save.png`
- Extra only: `desktop-light-overview-unavailable.png`, `desktop-light-overview-ai-blocked.png`, `mobile-light-review-queue.png`

Not present: mobile/dark unavailable, mobile/dark AI-blocked, Review AI-blocked / unavailable / empty, pairing failed-save, reduced-motion, post-decision queue, open Lock disclosure.

---

## Gate

Owner visual/behavior review of **one** desk should wait until blocking findings in `findings.md` are resolved or the owner explicitly accepts the open decisions (attention numeral, Lock on/off the claim card, nav chrome) **and** the Review concept restores or defers visibility + patch override in writing.

This checklist does not authorize Slice B–D implementation, app integration, or hosted migrations.
