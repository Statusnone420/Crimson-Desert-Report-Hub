# Maintainer Runbook

This page is the short operating checklist for maintainers.

## Daily Checks

- Open the live site and confirm the dashboard loads.
- Review pending reports in `/admin`.
- Check `/admin/source-monitor` for paused scans, failed runs, or suspicious source matches.
- Approve only excerpts that are useful and safe to publish.

## Before Running Automation

1. Confirm `AUTOMATION_BUDGET_USD_MONTHLY` is intentional.
2. Run `Test scan without publishing`.
3. Run the protected source preview route with a small query count.
4. Check that results are real issue reports, not reviews, guides, benchmarks, patch notes, or unrelated content.
5. Only then run a capped real scan.

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
- Prefer rejecting or hiding questionable excerpts over publishing them.
- Rotate exposed secrets immediately if a screenshot, issue, discussion, or commit leaks credentials.

## Useful Links

- [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md)
- [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md)
- [Privacy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md)
- [Security](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)
