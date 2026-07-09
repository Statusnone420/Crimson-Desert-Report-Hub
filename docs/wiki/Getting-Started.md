# Getting Started

## For Players

Open the live issue board when you want a quick, anonymous way to answer an existing issue question:

[https://crimsonreporthub.com/issues](https://crimsonreporthub.com/issues)

Choose *I have this too*, *Still happening*, or *Fixed for me*, then choose your platform. One network gets one current stance per issue per patch family, so tapping again changes your answer instead of adding another voter. After success, your selected stance is remembered locally, while public totals refresh from the server.

Use the report form when you have a specific Crimson Desert issue to document in detail:

[https://crimsonreporthub.com/report](https://crimsonreporthub.com/report)

Helpful reports usually include:

- Platform.
- Patch version.
- Issue category.
- Severity and frequency.
- A short title.
- What happened.
- Repro steps, if you have them.
- Optional evidence URL.

You do not need an account or email address. Raw report text is not published automatically, and the application does not store raw IP addresses.

## For Contributors

Start with the repository docs:

- [README](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/README.md)
- [Contributing](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/CONTRIBUTING.md)
- [Product Notes](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/PRODUCT.md)
- [Design Notes](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/DESIGN.md)

Local verification commands:

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
```

Run Playwright when UI behavior changes:

```bash
npm run test:e2e
```

## For Maintainers

Start with:

- [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md)
- [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md)
- [Security Policy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)

Before enabling automation, confirm the app works at N=0 with reports and confirmations empty, `AUTOMATION_BUDGET_USD_MONTHLY=2`, Tavily capped at 1,000 monthly credits, automation pinned to `deepseek/deepseek-v4-flash`, routine AI on `openrouter/free`/`:free` or deterministic fallback, and no Reddit API credentials. Create a dedicated OpenRouter key with a provider-side monthly reset limit of $2 or lower and verify that setting manually; the repository cannot verify the provider dashboard. Use the authenticated `/scanner` view for operator controls.
