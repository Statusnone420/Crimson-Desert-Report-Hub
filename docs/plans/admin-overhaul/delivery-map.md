# Admin workspace delivery record

The redesign is one integrated implementation. These steps describe the work and its evidence, not separate PRs or owner handoffs.

| Area | Implemented result | Required proof |
| --- | --- | --- |
| Shared frame | Seven internal views, website typography/palettes, fluid desktop width, preserved legacy routes | Both themes, standard/wide windows, keyboard navigation, sign-in return |
| Overview | Named decisions with honest queue windows; separate health and activity | Missing reads never claim zero; available items remain visible |
| Reports | Stale-decision protection and retained draft; partial approval gets excerpt-only retry | Browser failure/retry plus atomic status predicate and local SQL idempotency |
| Claims | Exact current pairings, reject/later/confirm, audit, retirement, safe undo | Local PostgreSQL tests, repeat scans, stale context, independent clock support, browser recovery |
| Scanner | Existing monitoring, controls, teaching, records, lessons, diagnostics | Retained write-path tests; unchanged policy and anonymous Observatory |
| Videos | Private inbox, editable review, private drafts, archive/restore, downloads | Stale edits, failure retention, privacy and public Watch unchanged |
| Dossiers | Deterministic default, explicit AI option, saved output/history | Compile/redirect/output, missing run, failed reads and retained option |
| Settings | Lifecycle locks, visibility recovery, current-patch override | Actual write/undo and public-state checks |

Local migration reset and the full database test suite passed. Final browser/integration results belong in the replacement PR. Historical reviews are supporting context only.

Merge, hosted migrations, and production deployment require owner approval. Changed scanner cadence, budgets, queries, models, provider expansion, and automatic video publishing remain outside this redesign.
