# Automation-First Signal Intelligence Design

Date: 2026-07-05

## Decision Summary

Crimson Desert Report Hub should not depend on users manually submitting reports before the site becomes useful. The next product pass changes the operating model from moderation-first to automation-first:

- Scheduled monitors collect Reddit and general web search results every 6 hours.
- OpenRouter `:free` models extract structured issue signals from gathered source material.
- Public dashboard data updates from automated signals once confidence thresholds pass.
- Direct user reports strengthen and verify automated clusters, but they are not the only data source.
- Admin review becomes optional quality control and correction, not the engine that keeps the site alive.
- Monthly automation spend is controlled by one number: `AUTOMATION_BUDGET_USD_MONTHLY`.

Approved direction:

- Data model: hybrid automated-and-direct model. Automated signals can drive public counts, but confidence/source tier remains visible.
- Sources for launch: Reddit plus general web search.
- Public promotion: confidence threshold required.
- Scan cadence: every 6 hours.
- Budget control: one tunable monthly dollar amount.

## Goals

1. Make the site feel alive without waiting for users to submit reports.
2. Keep automated claims honest by distinguishing signal strength.
3. Avoid creating an admin babysitting workflow.
4. Prevent hidden API spend.
5. Preserve the current privacy posture: no raw unreviewed text on public pages.
6. Keep implementation testable with fixtures and zero network calls in CI.

## Non-Goals

- No automated X runner in this pass. X can remain a future paid-source option.
- No publishing raw Reddit or web body text publicly.
- No unlimited crawling, scraping, or open-ended agent browsing.
- No background use of paid search if budget is `0` or exhausted.
- No reliance on OpenRouter to fetch web pages. OpenRouter classifies and extracts only after source results are already fetched.

## Source Strategy

### Reddit

Use the existing Reddit OAuth monitor as a source, but move it from admin-triggered only to scheduled automation.

Inputs:

- Configurable subreddit list, initially `CrimsonDesert`.
- Recent posts from Reddit's official OAuth API.
- Post title, permalink, created time, and short-lived raw body text.

Raw body text remains internal and expires after 48 hours.

### General Web Search

Add a search provider abstraction with Tavily as the first implementation.

Inputs:

- Fixed query pack focused on patch 1.13 issues:
  - `Crimson Desert patch 1.13 FPS`
  - `Crimson Desert 1.13 crash`
  - `Crimson Desert map crash`
  - `Crimson Desert PS5 Pro performance`
  - `Crimson Desert Steam stutter`
- Returned title, URL, snippet, source domain, and published/observed time when available.

Search API choice should remain swappable. Tavily has a usable free plan, while Brave/Google can be added later behind the same interface.

### OpenRouter

Use OpenRouter `:free` models as the extraction layer.

Responsibilities:

- Convert source text/snippets into structured candidate issue signals.
- Suggest category, platform, severity, confidence, and likely cluster.
- Return strict JSON only.

OpenRouter must not be required for basic operation. If it rate-limits, returns invalid JSON, or is unavailable, the deterministic keyword classifier still records lower-confidence signals.

Hard guardrail: configured OpenRouter model IDs must end with `:free`. A paid model ID should be rejected at startup or monitor-run validation unless a future spec explicitly changes this rule.

## One-Knob Budget Model

The only user-facing budget setting is:

```env
AUTOMATION_BUDGET_USD_MONTHLY=5
```

Default value: `5`.

Derived limits are calculated at runtime:

- Remaining budget for the current calendar month.
- Remaining scheduled runs in the current month.
- Allowed paid search queries for this run.
- Allowed OpenRouter extraction calls for this run.
- Allowed source results to process for this run.
- Whether paid work must be skipped.

Budget behavior:

- `0`: Reddit only, deterministic classifier only, no paid search.
- `1-5`: Reddit plus capped search queries and OpenRouter `:free` extraction when available.
- Exhausted budget: skip paid search, continue free Reddit/cached work, log `budget_capped`.
- Missing search key: skip web search and record `search_disabled`.
- Missing OpenRouter key: run deterministic extraction only.

The run summary must show what happened: allowed calls, used calls, skipped calls, and estimated spend.

## Scheduled Flow

Every 6 hours:

1. Start an automation run record.
2. Resolve the budget envelope for this run from `AUTOMATION_BUDGET_USD_MONTHLY`.
3. Fetch Reddit posts within caps.
4. Fetch web search results within caps.
5. Normalize each result into a source candidate.
6. Deduplicate by:
   - exact URL hash
   - source external ID hash
   - normalized title fingerprint
   - semantic issue fingerprint produced by deterministic extraction or OpenRouter
7. Extract structured signal data.
8. Upsert into `source_signals`.
9. Match or create an issue cluster.
10. Recompute cluster confidence and public eligibility.
11. Promote eligible clusters/signals to public aggregates.
12. Store a run summary with counts, skips, errors, and estimated cost.

## Public Promotion Rules

Automated material becomes public only when one of these is true:

1. Two or more independent source URLs mention the same issue within 14 days.
2. One direct user report matches the same issue.
3. One source has high-confidence exact issue language and clear category/platform.

Definitions:

- Independent source URLs means different canonical URLs. Same Reddit post mirrored elsewhere does not count twice when detected.
- Direct reports are stronger than automated signals.
- Admin approval can force-promote or hide a cluster, but the default path should not require admin action.

Public labels:

- `Community signals`: automated Reddit/search signals that passed threshold.
- `Direct reports`: structured user submissions.
- `Verified reports`: admin-approved direct reports or curated excerpts.

The main dashboard should show automated activity without mixing it silently into verified report counts.

## Data Model Changes

Extend existing tables instead of replacing them.

### `source_signals`

Add or confirm fields for:

- `canonical_url`
- `title`
- `source_domain`
- `source_type`: `reddit`, `web_search`, later `x_search`
- `semantic_fingerprint`
- `cluster_id`
- `public_status`: `private`, `public`, `hidden`
- `promoted_at`
- `promotion_reason`
- `extraction_provider`: `deterministic`, `openrouter`
- `extraction_model`
- `cost_estimate_usd`

Keep:

- `summary`
- `category`
- `confidence`
- `observed_at`
- `raw_text`
- `raw_expires_at`

### `issue_clusters`

Add or confirm fields for:

- `signal_count`
- `direct_report_count`
- `verified_report_count`
- `public_signal_count`
- `last_signal_at`
- `auto_public`: boolean
- `admin_visibility_override`: nullable enum, `force_public` or `force_hidden`

### `automation_runs`

Create a run ledger:

- `id`
- `started_at`
- `finished_at`
- `status`: `success`, `partial`, `failed`, `skipped`
- `budget_monthly_usd`
- `budget_remaining_before_usd`
- `estimated_cost_usd`
- `reddit_posts_seen`
- `search_queries_used`
- `search_results_seen`
- `llm_calls_used`
- `signals_inserted`
- `signals_deduped`
- `clusters_promoted`
- `skips`: jsonb
- `errors`: jsonb

This ledger is the core protection against accidental cost and silent failures.

## Admin Experience

Admin should become an observability and override surface:

- Last automation run status.
- Current month budget and estimated usage.
- Buttons:
  - `Run dry scan`
  - `Run capped scan now`
  - `Hide cluster`
  - `Force public`
  - `Merge clusters`
- Recent automation errors.
- Signals skipped due to budget or low confidence.

Admin review is optional. The system should keep working if the admin does nothing.

## Public Experience

Dashboard changes:

- Replace or augment `Approved reports` with a combined top-line:
  - `Community signals`
  - `Direct reports`
  - `Verified reports`
  - `Awaiting review`
- Top issues should rank by weighted activity:
  - community signals count
  - direct reports count
  - recency
  - confidence
  - persistent fix status
- Each issue row should expose source strength:
  - `12 signals`
  - `3 direct reports`
  - `1 verified excerpt`

Issue page changes:

- Show public signals and direct reports separately.
- Never show raw unreviewed source text.
- Link to source URLs where allowed and useful.
- Label low/medium/high confidence visibly.

Report form changes:

- User reports should ask whether the issue matches an existing cluster suggested by title/category, but this is optional.
- A submitted direct report can strengthen an existing automated cluster.

## Dossier Changes

The dossier compiler should include both automated and direct data, clearly separated:

- Executive summary with signal/direct/verified counts.
- Top automated community signals.
- Direct report evidence.
- Confidence gaps.
- Source links.
- Issues that persist after claimed fixes.

OpenRouter can still draft prose, but deterministic Markdown remains the source of truth.

## Error Handling

- Search provider unavailable: record run as `partial`, continue Reddit.
- Reddit unavailable: record run as `partial`, continue search if budget permits.
- OpenRouter unavailable: fallback to deterministic classifier.
- Invalid OpenRouter JSON: discard that extraction, record error, fallback deterministic.
- Budget exhausted: skip paid work, record `budget_capped`, do not fail run.
- Database insert failure: fail the affected run stage and expose error in admin.

## Testing Requirements

All tests must use fixtures and mocks. CI must never call Reddit, search APIs, or OpenRouter.

Required unit tests:

- Budget resolver:
  - budget `0` allows no paid search.
  - budget `5` derives bounded per-run caps.
  - exhausted budget skips paid work.
  - remaining budget is spread across remaining monthly runs.
- Search planner:
  - query count cannot exceed cap.
  - dry-run produces no external calls.
- Extraction parser:
  - valid OpenRouter JSON parses.
  - invalid JSON falls back deterministic.
  - model output cannot create arbitrary categories/platforms.
- Dedupe:
  - same URL dedupes.
  - same Reddit ID dedupes.
  - same normalized title dedupes.
  - same semantic fingerprint dedupes.
- Promotion:
  - one weak source stays private.
  - two independent sources promote public.
  - one direct report promotes or strengthens a matching cluster.
  - admin `force_hidden` blocks public display.
  - admin `force_public` overrides threshold.
- Cost safety:
  - no monitor run can exceed derived search cap.
  - no monitor run can exceed derived LLM cap.
  - skipped paid work is recorded.

Required route/integration tests:

- Cron monitor runs with mocked providers.
- Cron monitor rejects unauthorized requests when `CRON_SECRET` is set.
- Automation run ledger is written for success, partial, and budget-capped runs.

Required Playwright tests:

- Dashboard shows separate `Community signals`, `Direct reports`, and `Verified reports`.
- A low-confidence single-source issue does not appear publicly.
- A promoted two-source issue appears publicly with confidence labels.
- Admin automation page shows last run, budget usage, and skipped work.

## Implementation Boundaries

Recommended modules:

- `src/lib/automation/budget.ts`
- `src/lib/automation/search.ts`
- `src/lib/automation/reddit.ts`
- `src/lib/automation/extract.ts`
- `src/lib/automation/dedupe.ts`
- `src/lib/automation/promote.ts`
- `src/lib/automation/run.ts`

Keep existing public UI components where possible. Do not rewrite the design system.

## Implementation Details Deferred to Plan

- Exact Tavily request shape and result fields.
- Exact OpenRouter `:free` model priority list.
- Exact weighted ranking formula for top issues.
- Whether `automation_runs` should store raw provider payload metadata or only summaries.

These are implementation choices and do not change the approved product model.
