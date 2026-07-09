# Maintainer Runbook

This page is the short operating checklist for maintainers.

## Daily Checks

- Open the live site and confirm the dashboard loads.
- Review pending reports in `/admin`.
- Open the authenticated `/scanner` view for paused scans, failed runs, suspicious radar leads, and the expiring rejected archive.
- Review only real claim-mapping exceptions or explicit lifecycle locks in `/admin`; normal days should require no lifecycle clicks.
- Approve only excerpts that are useful and safe to publish.

## Before Running Automation

1. Confirm `AUTOMATION_BUDGET_USD_MONTHLY=2`, Tavily is within the 1,000-credit envelope, and high-value automation is pinned to `deepseek/deepseek-v4-flash`.
2. Confirm routine report moderation/dossier prose use `openrouter/free`/`:free` or deterministic fallback.
3. In OpenRouter, manually confirm the deployment's dedicated key has a monthly limit of $2 or lower with monthly reset. The repository cannot verify this provider-side setting.
4. Confirm no Reddit API credentials or direct subreddit monitor are configured.
5. Run `Test scan without publishing`.
6. Run the protected source preview route with a small query count; extraction on this route is deterministic and does not call OpenRouter.
7. Check that results are plausible issue pages, not reviews, guides, benchmarks, patch notes, or unrelated content.
8. Confirm mapped public items read as lead questions, never evidence.
9. Only then run a capped real scan.

## Confirmation Board Checks

- Confirm that a successful tap acknowledges the selected stance but leaves totals server-authored until refresh.
- Confirm one network can change stance for an issue/patch family without adding another voter.
- Confirm claim polls are attributed to the exact claimed patch version; `1.13.00` must not render as a `1.13.01` claim.
- Confirm only post-clock `Still happening` / `Fixed for me` taps and exact-version post-clock structured reports affect the claim readout. Scanner links remain leads.
- Confirm hidden or missing issues return `unknown_issue` without consuming a confirmation-attempt entry.
- Treat the 20-writes/network/hour ledger as an abuse limit, not identity.

## Overrides

- Use lifecycle locks only for real exceptions; clear them to return control to automation.
- Use `Force public` or `Force hidden` for an immediate atomic visibility change. `Auto` only clears the override; normal promotion re-evaluates effective visibility on the next scan. Database guards preserve forced state across concurrent scanner writes; public pages revalidate after the action.
- Scanner links remain leads even when a visibility override makes a cluster public.

## Before Release

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
```

Run a secret scan before pushing:

```bash
rg -n "(sb_secret_|sk-or-|tvly-|SUPABASE_SERVICE_ROLE_KEY|OPENROUTER_API_KEY|TAVILY_API_KEY)" .
```

Only placeholder names should appear in documentation or examples.

## If Something Looks Wrong

- Pause scheduled scans.
- Keep direct reports available if public pages are healthy.
- Do not delete data until the cause is understood.
- Prefer rejecting or hiding questionable excerpts/leads over publishing them.
- Rotate exposed secrets immediately if a screenshot, issue, discussion, or commit leaks credentials.

## Useful Links

- [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md)
- [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md)
- [Privacy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md)
- [Security](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)
