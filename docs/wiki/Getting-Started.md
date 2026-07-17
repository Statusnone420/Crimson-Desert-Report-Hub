# Getting Started

## For players

Open the [issue board](https://crimsonreporthub.com/issues) to inspect current-patch issues and answer a question with *I have this too*, *Still happening*, or *Fixed for me*. Choose a platform. One network has one current stance per issue and patch family, so answering again changes your current response instead of creating another voter.

Use the [report form](https://crimsonreporthub.com/report) when you have a specific problem to document. A useful report includes the platform, patch, category, severity, frequency, short title, what happened, and reproduction steps when available. Evidence links and hardware details are optional.

No account or email is required. Raw report text is not published automatically, and raw IP addresses are not stored in the application database.

## For contributors

Start with:

- [Repository README](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/README.md)
- [Product Notes](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/PRODUCT.md)
- [Architecture](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/ARCHITECTURE.md)
- [Contributing](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/CONTRIBUTING.md)

From the repository root:

~~~powershell
npm install
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
npm run test:e2e:n0
~~~

Public docs explain product guarantees and privacy boundaries. They intentionally do not try to teach private discovery, ranking, prompt, or moderation recipes.

## For maintainers

Use the [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md) for first setup and the [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md) for live work. Before enabling automation, confirm provider caps, the linked migration list, the protected scheduler, and an honest N=0 public view.
