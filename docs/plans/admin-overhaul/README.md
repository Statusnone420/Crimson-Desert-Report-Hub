# Admin overhaul — Slice A

Planning docs only. This folder is **not** product authority and does **not** authorize application, CSS, migration, or production work.

**Baseline:** `origin/main` @ `2a0953a671ebed2cd5a09d147fd755be4458af4e` (merged PR #95).

This integrated draft supersedes the WIP-only PRs:

- [#96](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/96) — spec (`cursor/slice-a-admin-spec-0b16` @ `cac22aa`)
- [#97](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/97) — concept (`slice-a/admin-concept` @ `86a6086`)
- [#99](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pull/99) — independent review (`slice-a/admin-review` @ `e348b47`)

Those PRs stay open. Do not merge them into `main`.

Independent review **verdict: NEEDS FIXES**. Blocking issues are listed for the owner in [`SLICE-A-HANDOFF.md`](SLICE-A-HANDOFF.md#independent-review--needs-fixes). Spec and concept were not rewritten to paper over them.

## Open the concept

No Next.js, Docker, or static server.

1. Open [`concept/index.html`](concept/index.html) in a desktop browser (double-click, or `xdg-open docs/plans/admin-overhaul/concept/index.html`).
2. Confirm the amber rail reads **Concept demo · invented sample · in-memory only · no network**.
3. Use the rail for Theme, Surface (Overview / Review), and Situation (Normal, Empty, AI-blocked, Unavailable, Failed-save).
4. Decisions stay in the tab until reload. Sample copy is invented and labeled. The page does not fetch fonts, images, or JSON.

Full steps: [`concept/README.md`](concept/README.md).

## Slice A deliverables

| Path | What it is | Source |
| --- | --- | --- |
| [`spec/`](spec/) | Behavior and data contracts: capabilities, metrics/attention, claim-review, surface notes, three owner data calls | Agent 1 / PR #96 — copied, not rewritten |
| [`concept/`](concept/) | Self-contained Overview + Report/Claim Review HTML/CSS/JS, screenshots, verification | Agent 2 / PR #97 — copied, not rewritten |
| [`review/`](review/) | Independent review of spec + concept. **Verdict: NEEDS FIXES.** | Agent 3 / PR #99 — copied, not rewritten |
| [`README.md`](README.md) | This index | Agent 4 (integrator) |
| [`delivery-map.md`](delivery-map.md) | Proposed Slices B–D, risks, stop gates. **No authorization to start B–D.** | Agent 4 |
| [`SLICE-A-HANDOFF.md`](SLICE-A-HANDOFF.md) | Base SHA, files, checks vs gaps, review blocking issues, merged owner-decision list | Agent 4 |

### Spec (behavior wording)

- [`spec/capability-inventory.md`](spec/capability-inventory.md)
- [`spec/metrics-attention-contract.md`](spec/metrics-attention-contract.md)
- [`spec/claim-review-contract.md`](spec/claim-review-contract.md)
- [`spec/surface-notes.md`](spec/surface-notes.md)
- [`spec/open-decisions.md`](spec/open-decisions.md)

If spec and concept disagree on labels or actions, **prefer the spec for behavior wording**. Record the clash in [`SLICE-A-HANDOFF.md`](SLICE-A-HANDOFF.md); do not invent a third design.

### Concept (visual)

- [`concept/index.html`](concept/index.html) — entry
- [`concept/README.md`](concept/README.md) — how to open
- [`concept/VERIFICATION.md`](concept/VERIFICATION.md) — checks actually run
- [`concept/open-visual-decisions.md`](concept/open-visual-decisions.md) — visual owner calls
- [`concept/screenshots/`](concept/screenshots/) — 1440×1100 and 390×844 renders of invented samples (not production admin)

Key screenshot paths:

- [`concept/screenshots/desktop-light-overview-normal.png`](concept/screenshots/desktop-light-overview-normal.png)
- [`concept/screenshots/desktop-light-review-claim.png`](concept/screenshots/desktop-light-review-claim.png)
- [`concept/screenshots/desktop-light-review-failed-save.png`](concept/screenshots/desktop-light-review-failed-save.png)
- [`concept/screenshots/desktop-light-overview-empty.png`](concept/screenshots/desktop-light-overview-empty.png)
- [`concept/screenshots/mobile-light-overview-normal.png`](concept/screenshots/mobile-light-overview-normal.png)
- [`concept/screenshots/mobile-light-review-claim.png`](concept/screenshots/mobile-light-review-claim.png)

### Independent review (PR #99)

- [`review/findings.md`](review/findings.md) — verdict, contradictions, retained-capability drops, evidence gaps
- [`review/acceptance-checklist.md`](review/acceptance-checklist.md) — owner-brief grid

**Verdict: NEEDS FIXES.** This integrator PR copied those files; it did not “fix” spec or concept. Owner visual/behavior review of one desk should wait until the blocking list is resolved or the owner explicitly accepts the open mismatches.

## Hard constraints (still in force)

- Docs and concept only under `docs/plans/admin-overhaul/`.
- No application code, shared CSS, migrations, dependency changes, paid calls, scanner runs, or production writes.
- Do not start Slices B–D from this PR.
- Do not use, push, or delete `admin/redesign-plan`.
- Preserve invented-data labeling in the concept.
- Operating baseline stays **2h cadence / 3 searches per run**.
- Public `/scanner` Observatory, video inbox #94, and scanner AI diagnostics #95 stay intact in the proposed design.

Owner calls that still need a decision: [`SLICE-A-HANDOFF.md`](SLICE-A-HANDOFF.md#owner-decisions).
