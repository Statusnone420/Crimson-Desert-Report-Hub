# State of Play and Next Steps

This is the maintainer handoff. It describes the repository's current product shape and remaining decisions. Deployment health, provider configuration, and applied migrations require a fresh check of the target environment.

## Current posture

- The front page is a **fan newspaper**: an original lead article, selected external coverage, official fix excerpts, player report totals, aggregate charts, and a creator spotlight.
- `/news` lists original reporting and selected external coverage; `/watch` links to original video sources. `/feed.xml` and `/rss.xml` contain original Hub articles only.
- `/patches` holds the official patch record and claimed fixes. `/observatory` holds review and audience context plus the source radar.
- `/issues` is the evidence surface: structured reports, confirmation signals, reviewed source links, and exact-patch fix-claim polls remain visibly separate.
- `/operator` is the signed-in overview. `/scanner` shows scanner controls to the maintainer and the Observatory to anonymous readers. Discovery cannot publish newspaper selections automatically.
- `/report` is anonymous structured intake. `/about` explains the method and `/privacy` summarizes the privacy policy.
- The app is designed for N=0. Empty reports, empty confirmations, and a quiet radar must render as honest states, not marketing failure states.
- Migration files include the observation lane and patch-scoped identity. Compare them with the target environment's applied history before a release; a committed migration is not proof it has run there.
- The hourly wake-up is the Cloudflare Worker in `cloudflare/scanner-cron`; the application owns scheduling decisions, budget accounting, and publishing rules.

## First checks after a release

1. Bind the production deployment to the intended commit and confirm CI and deployment readiness.
2. Open `/`, `/news`, the linked article, `/watch`, `/patches`, `/issues`, `/observatory`, `/report`, `/about`, and `/privacy`. Confirm the feeds return Atom and RSS XML.
3. Compare the shared masthead date after hydration on direct loads and navigation. It uses the current New York day; initial HTML intentionally says `Eastern Time`.
4. Confirm the patch desk links to the current official patch. Check source dates and attribution on editorial coverage separately from the masthead date.
5. Confirm empty states remain honest and unavailable reads are not presented as zero. The separate N=0 browser suite checks both empty fixture data and missing service configuration without creating production data.
6. With the required access, inspect `/operator` and `/scanner`; check collection health, the latest scheduled run, and budget accounting. Do not infer private health from a successful public page load.
7. Exercise report submission, check-ins, or moderation only with authorization for those production writes. Check that confirmations refresh from server totals.

## Ranked follow-up

### Product and design context

- Use the refreshed [Product Notes](../PRODUCT.md) and [Design Notes](../DESIGN.md) as the starting point for the next product-language review. New design decisions still require owner direction.
- Keep original articles, reviewed external selections, and scanner leads separate when adding coverage. Automated creator discovery remains separate future work, not an active publishing path.
- For further desk-date verification, exercise New York midnight and returning to a suspended tab in the deployed browser. Automated date tests are not proof of every live browser/CDN condition.

### Keep observing

- Watch the first real patch-aware scan windows after a new official patch and compare provider ledger entries with the published budget policy.
- Compare source-radar leads with actual approved reports. The important signal is whether leads produce useful questions, not how many links the scanner finds.
- Keep an eye on the N=0 experience. Empty pages should continue to explain what is known and what still needs evidence.

### Improve when evidence justifies it

- Add operational alerting only when the current run ledger and scanner page are insufficient to catch a failed or paused scan in time.
- Revisit cadence or provider allocation only with a fresh budget review; do not solve a discovery concern by silently raising the Tavily or OpenRouter caps.
- Consider a formal contributor/admin identity model only if shared-password operations become a real bottleneck.

### 2026-07-20 audit P3s — resolved

The July 20 audit recorded these P3s as resolved. The details below describe that audit's code and hosted observations; they are not a current health check or a new to-do list.

- **Unindexed foreign keys**: covering indexes added for `automation_rejected_candidates.run_id` and `signal_observation_events.run_id` (`20260720202450_fk_covering_indexes_run_id.sql`, applied to production).
- **Unused indexes** flagged by the advisor: reviewed and deliberately retained — every flagged table is tiny (hundreds of rows at most), several indexes serve brand-new features (`signal_observation_events` shipped the same week), and dropping them saves nothing measurable. Re-check the advisor after a month of traffic before removing any.
- **RLS enabled with no policies** on service-role-only tables (`issue_confirmations`, `patch_observations`, etc.): intentional default-deny — documented so the advisor INFO notices are not re-investigated from scratch.
- **Rejected-candidate duplication**: `persistRejectedCandidates` now dedupes against the un-expired reject pile by URL and refreshes the existing row's retention window instead of stacking duplicates.
- **Tracked-lead count vs raw signal rows**: the radar reports fewer tracked leads than raw non-hidden `source_signals` rows because stale/unsupported/wrong-patch rows are excluded by `isCurrentPatchRadarLead`. Expected, not a bug.
- **Near-duplicate cluster fingerprints**: `semanticFingerprint` now strips patch-version tokens and narration filler (articles, first-person framing) so rephrasings of one complaint share a fingerprint. Note: stored fingerprints predate this change, so an old signal re-encountered under new wording can still route fresh — URL-level dedupe still catches exact re-observations.

### Do not reopen casually

- Reddit API access, direct subreddit monitoring, raw public complaint feeds, analytics trackers, and verdict language are outside the product contract.
- A quiet board is not evidence that a bug is fixed.
- Private planning notes and agent handoffs are not part of the public release contract.

## Fast health check

```text
live pages -> admin scanner -> latest run ledger -> provider caps -> Supabase migration list
```

For the detailed procedure, use [Operations Guide](OPERATIONS.md), [Launch Checklist](LAUNCH_CHECKLIST.md), and the [Maintainer Runbook](wiki/Maintainer-Runbook.md).
