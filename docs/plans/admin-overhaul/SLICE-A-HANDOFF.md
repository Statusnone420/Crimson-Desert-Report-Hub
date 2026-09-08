# Admin workspace implementation record

This file keeps its earlier path so existing planning links remain usable. The work is a complete replacement workspace, not a Slice A handoff.

## Scope

Baseline: `main` at `2a0953a671ebed2cd5a09d147fd755be4458af4e` (PR #95). Seven destinations share one private sidebar and theme system. The owner approved the replacement desktop layout, then requested the site's visual identity, readable light/dark themes, and fluid window width.

Compatibility includes signed-out `/scanner` to public Observatory, all existing admin routes, the PR #94 private video contract, the PR #95 private diagnostics, and the existing scanner operating policy.

## Database changes

- `20260907190115_claim_review.sql`: private exact-claim pairings, append-only audit, atomic revision checks, retirement, independent clock support, and matching owner-brief counts.
- `20260907201500_report_excerpt_retry.sql`: idempotent excerpt-only retry for an already-approved report.

Local `db:start` and fresh `db:reset` succeeded. The complete local pgTAP suite passed 166 checks across five files. No hosted database was changed.

## Verification

Local verification passed:

- `npm test`: 1,609 tests across 128 files.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build`: passed.
- `npx playwright test --workers=1`: 127 passed; nine existing device-specific cases skipped as configured.
- `npm run test:e2e:n0`: two passed.
- `npm run test:e2e:turnstile`: eight passed.
- Fresh local database reset, full pgTAP: 166 tests across five files.
- `supabase db lint --local --schema public`: no schema errors.
- Final independent read-only integration review: no additional actionable regression found.

The PR records the exact commit and hosted CI results. [Current screenshots](screenshots/README.md) supplement these tests; historical concept captures do not substitute for them.

Browser coverage exercises actual local server actions with invented fixtures, separately from the real local PostgreSQL transaction tests. It covers stale decisions, failed saves, excerpt-only retry, claim history/undo, video draft privacy, dossier output, sign-in return paths, both palettes, and standard/wide desktop dimensions.

## Release

The owner must approve merge, hosted migration, and deployment after the PR is verified. Apply only the reviewed migration files through the approved hosted process. Until then, the new claim-review UI must display its unavailable/read-only state, while the scanner preserves the narrowly identified pre-migration path.

The current work does not change paid provider policy or run a paid search bake-off. Scanner `dry_run` retains the existing private run ledger while preventing public/pairing writes; it is not a promise that no private log is written.

After the replacement PR is verified, close superseded PRs #96-#99 and clean obsolete local previews and task-owned processes. Preserve the owner's existing planning checkout and files.
