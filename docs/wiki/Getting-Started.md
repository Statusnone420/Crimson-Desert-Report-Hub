# Getting Started

## For players

Start with the [newspaper](https://crimsonreporthub.com/) for original reporting and selected coverage, or the [patch desk](https://crimsonreporthub.com/patches) for official fixes and player responses. [Atom](https://crimsonreporthub.com/feed.xml) and [RSS](https://crimsonreporthub.com/rss.xml) subscriptions contain original Hub articles only.

Open the [issue board](https://crimsonreporthub.com/issues) to inspect current-patch issues and answer a question with *Happening to me*, *Still happening*, or *Fixed for me*. Choose a platform. One network has one current stance per issue and patch family, so answering again changes your current response instead of creating another voter.

Use the [report form](https://crimsonreporthub.com/report) when you have a specific problem to document. A useful report includes the platform, patch, category, severity, frequency, short title, what happened, and reproduction steps when available. Evidence links and hardware details are optional.

No account or email is required. Raw report text is not published automatically, and raw IP addresses are not stored in the application database.

## For contributors

Start with:

- [Repository README](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/README.md)
- [Product Notes](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/PRODUCT.md)
- [Architecture](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/ARCHITECTURE.md)
- [Contributing](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/CONTRIBUTING.md)

Use Node.js 22 and npm. For a local UI preview with invented data, run from the repository root:

~~~powershell
npm ci
npm run preview:seed
npm run dev:preview
~~~

Open `http://127.0.0.1:3130`. This preview uses an in-memory database fixture and does not prove hosted data or provider health. For configured services, `npm run dev` uses `.env.local` and is not inherently isolated from production. Follow [Contributing](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/CONTRIBUTING.md#development) for setup and required checks.

Public docs explain product guarantees and privacy boundaries. They intentionally do not try to teach private discovery, ranking, prompt, or moderation recipes.

## For maintainers

Use the [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md) for first setup and the [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md) for live work. Before enabling automation, confirm provider caps, the linked migration list, the protected scheduler, and an honest N=0 public view.
