# Admin capability inventory

Retained capability contract for the implemented replacement workspace. Verification is recorded separately.

**Baseline:** `origin/main` at `2a0953a671ebed2cd5a09d147fd755be4458af4e` (PR #95). Keep the 2-hour / 3-search operating baseline, budgets, approved models, cost circuit, key-limit rules, Reddit-off policy, and public/private boundaries.

## Product boundary

The signed-in desktop shell has seven internal destinations: Overview, Reports, Claim review, Scanner, Videos, Dossiers, and Settings & tools. Existing authenticated/public routes continue to work while the shell is introduced. The operator shell is private and `noindex`; login and return validation stay in `src/lib/adminGuard.ts` and `src/lib/loginReturn.ts`.

Anonymous `/scanner` is a special compatibility contract: `isAdmin()` false renders `ObservatoryPage`. It must not redirect to login. `/observatory` remains public. This redesign does not change either audience.

The shell retains theme, Export CSV, sign out, preview notice, keyboard focus behavior, and the 12-hour session. Export remains a private report export; it does not gain pairing audits, private video identities, or diagnostics.

## Workspace inventory

| Workspace | Existing source/handler | Required retained or intended behavior |
| --- | --- | --- |
| Overview | `/operator`; `WorkspaceOverview`; `operatorOverview.ts`; `getScannerAiHealth` | Read-only quick check. Name owner decisions and operational incidents separately. Never use background inventory as work. `safeRunSummary` continues to remove raw errors. |
| Reports + Claims | `/admin`; `readReportReviewQueue`; `splitClusterExceptions`; `src/app/admin/actions.ts` | Keep report moderation, excerpts, visibility override, current-patch override, lifecycle records, and add the durable pairing workflow in [`claim-review-contract.md`](claim-review-contract.md). |
| Scanner | authenticated `/scanner`; `AdminScannerView`; `ScanControls`; feedback/lesson handlers | Keep one workbench for scan controls, collection health, private diagnostics, Teach, Records, Lessons, and history. Reword metrics honestly; do not change policy. |
| Videos | `/admin/videos`; `videoReviewStore`; video actions | Retain PR #94 manual inbox, private later-PR drafts, stale revision, Archive/Restore, and unavailable behavior. |
| Dossiers | `/admin/compile`; `compileDossier` | Keep on-demand deterministic compile and opt-in AI prose. Missing `?run=` means missing, not an empty history. |

## Reports + Claims

### Flagged reports

`readReportReviewQueue` remains the private queue. Read/count failure reaches the admin error state; it never produces a fabricated all-clear. `moderateReport` retains Approve, Reject, and Spam. Existing Approve may commit moderation before a later approved-excerpt write fails; the redesign must show that committed/failed split instead of silently removing the item.

Raw description, reproduction, hardware, PERS identifiers, and unapproved text stay private. Only a successful approved excerpt may become public under the existing rules.

### Existing exceptional controls

The following survive as a distinct break-glass area. They are not claim-pairing actions and are excluded from routine pending counts.

| Control | Existing handler | Contract |
| --- | --- | --- |
| Lifecycle lock | `setClusterFixStatus` | Issue-wide `admin_override`; it may set Open, Fix claimed — unverified, Marked fixed by maintainer, or Still happening. Claim-bearing lock refuses fallback patch provenance. |
| Clear lock | `clearClusterFixStatusOverride` | Clears override/reason and synthesized clock; preserves existing lifecycle behavior until the next pass. |
| Visibility override | `setClusterVisibilityOverride` | Force public/hidden with reason, confirmation, and Reset to automatic. It never changes evidence counts or pairing state. |
| Current patch override | `setCurrentPatchOverride` | Break-glass current version; next successful official sync reclaims it. Manual provenance creates no official claim pairings. |

Do not default to private-cluster expansion. Current lifecycle mapping uses public clusters; widening it requires a separate approved contract.

## Scanner

`POST /api/admin/scan` has `manual` and `dry_run` modes. `dry_run` retains the existing private run ledger. It does not persist public signals, claim pairings, or provider collection snapshots, and does not revalidate public surfaces. Preserve this existing execution contract. `assertProductionWriteAllowed` / `previewWriteAllowed` remains a second, environment-specific protection for preview writes; it cannot substitute for the dry-run guard.

Keep the current scanner workbench together. `recordScannerDecision`, `undoScannerDecision`, `rejectObservationAndTeach`, and related feedback paths may influence discovery or relevance only. They must not publish a lead, bypass corroboration, or alter evidence counts.

PR #95 `progress.openRouterDiagnostics` remains a bounded allowlisted private diagnostic. It has no public rendering, raw body, key, URL, report text, provider identity, or automatic attention-count effect.

Scanner labels retain these meanings:

- **Awaiting**: private leads lacking corroboration, not a queue.
- **Candidates reviewed**: screening events, not unique URLs or human reviews.
- **Radar yield**: retained-lead share of screened candidates, not accuracy.
- **Run status** and **AI health** are distinct. A completed scan can have unavailable/limited AI.

## Videos and brief

PR #94 remains intact. `addVideoReviewCandidate` accepts manual validated input; `saveVideoReviewCandidate` detects stale revisions; `approveVideoCandidate` produces a private later-PR draft only; Archive/Restore retains brief behavior; and missing video schema is unavailable rather than empty. No video is automatically published or added to Watch.

`readOwnerAttentionBrief` and `owner_attention_brief()` remain counts-and-safe-next-steps only. Keep the JSON keys `unsureClaimMatches` and `needsYou`. The default is one approved brief, not a generated interview. It excludes titles where not needed, raw report content, private URLs, video IDs, review notes, and claim text. Old/new schema disagreement is visible as unavailable or documented disagreement, never collapsed to zero.

## Dossiers and public output

`compileDossier` remains on demand. Deterministic output is always available; AI prose is opt-in and fails open to deterministic output. Preserve the private-data warning for the optional AI path.

Public output never gains raw reports, rejected candidates, private sources, network hashes, credentials, individual provider identities, or pairing audit rows. Steam/Twitch/IGDB remain aggregate context, never player evidence.

## Verification scope for implementation

Trace callers before moving a control. Preserve existing test coverage for auth, return validation, moderation, visibility, lifecycle, scanner feedback, videos, owner brief, anonymous Observatory, and public privacy. Add focused tests for changed claim, dry-run, shell, and error-state behavior. See the implementation record and PR for executed checks.
