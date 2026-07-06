# Getting Started

## For Players

Use the live report form when you have a specific Crimson Desert issue to document:

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

You do not need an account. Raw report text is not published automatically.

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

Before enabling optional automation, confirm the app works with direct reports and budget set to `0`.
