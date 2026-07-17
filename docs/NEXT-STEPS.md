# State of Play and Next Steps

This is the maintainer's resume-cold note. It records the current product shape and the next operational decisions without pretending that a historical PR number is a permanent project status page.

## Current posture

- The live product is the **Patch Brief**: a patch-aware public readout with a right-now rail, literal metric cards, a claimed-fix scoreboard, community pulse, source coverage, and links to the issue board.
- `/issues` is the evidence surface: structured reports, confirmation signals, reviewed source links, and exact-patch fix-claim polls remain visibly separate.
- `/scanner` is a public source radar with authenticated maintainer controls. It maps public links into questions; it does not publish raw candidates or turn links into evidence.
- `/report` is anonymous structured intake. `/about` explains the method and privacy posture.
- The app is designed for N=0. Empty reports, empty confirmations, and a quiet radar must render as honest states, not marketing failure states.
- The production schema includes the patch observation lane and patch-scoped observation identity. Keep local migration filenames aligned with the remote history.
- The hourly wake-up is the Cloudflare Worker in `cloudflare/scanner-cron`; the application owns scheduling decisions, budget accounting, and publishing rules.

## First checks after a release

1. Open `/`, `/issues`, `/report`, `/scanner`, and `/about` on the production domain.
2. Confirm the Patch Brief identifies the current official patch and links to the official source.
3. Confirm N=0 copy remains honest when there are no public reports or observations.
4. Open `/scanner` anonymously and authenticated; verify the public and operator views show the same integration truth.
5. Review the latest scheduled run and confirm Tavily credits, extraction work, and any skips are accounted for.
6. Submit one controlled test report only when you intend to exercise production intake; moderate or remove it according to the current owner workflow.
7. Check that a confirmation refreshes from server totals and does not claim an optimistic count.

## Ranked follow-up

### Keep observing

- Watch the first real patch-aware scan windows after a new official patch and compare provider ledger entries with the published budget policy.
- Compare source-radar leads with actual approved reports. The important signal is whether leads produce useful questions, not how many links the scanner finds.
- Keep an eye on the N=0 experience. Empty pages should continue to explain what is known and what still needs evidence.

### Improve when evidence justifies it

- Add operational alerting only when the current run ledger and scanner page are insufficient to catch a failed or paused scan in time.
- Revisit cadence or provider allocation only with a fresh budget review; do not solve a discovery concern by silently raising the Tavily or OpenRouter caps.
- Consider a formal contributor/admin identity model only if shared-password operations become a real bottleneck.

### Do not reopen casually

- Reddit API access, direct subreddit monitoring, raw public complaint feeds, analytics trackers, and verdict language are outside the product contract.
- A quiet board is not evidence that a bug is fixed.
- Private planning notes and agent handoffs are not part of the public release contract.

## Fast health check

```text
live pages -> admin scanner -> latest run ledger -> provider caps -> Supabase migration list
```

For the detailed procedure, use [Operations Guide](OPERATIONS.md), [Launch Checklist](LAUNCH_CHECKLIST.md), and the [Maintainer Runbook](wiki/Maintainer-Runbook.md).
