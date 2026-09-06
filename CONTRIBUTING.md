# Contributing

Thanks for helping improve Crimson Desert Report Hub.

The project is public for transparency and review. Contributions should make the product easier to trust, safer to operate, or clearer to use. Public docs describe the product contract; they do not promise that private discovery, ranking, prompt, or moderation recipes will remain stable or be documented.

## Good Contributions

- Bug fixes with tests.
- Accessibility improvements.
- Privacy/security hardening.
- Clearer documentation.
- Safer automation heuristics.
- UI polish that preserves the newspaper's identity and keeps player and operator workflows readable.

The site already uses attributed Pearl Abyss imagery. Preserve source attribution and the unofficial disclaimer; do not assume the code's Apache license covers third-party assets. Do not add scraped private content, ad/analytics scripts, or features that publish unreviewed raw report text.

## Development

Use Node.js 22 and npm, matching CI. From the repository root:

```bash
npm ci
```

For UI work with invented data and no hosted database writes:

```bash
npm run preview:seed
npm run dev:preview
```

Open `http://127.0.0.1:3130`. The seed is local and ignored by Git. This preview exercises the app with fixture data; it does not prove production data or provider health.

For a configured development database, copy `.env.local.example` to `.env.local`, fill the required values, and run `npm run dev` (normally port 3000). This uses the configured services; it is not automatically isolated from production. Never commit `.env.local`. See [Operations](docs/OPERATIONS.md) for environment options and [Design Notes](DESIGN.md) for the current visual system.

## Verification Before Pull Request

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
```

If the UI changes, also run:

```bash
npm run test:e2e
```

Install Chromium once with `npx playwright install chromium`. Browser tests start their own fixture server; Windows CI runs the desktop and mobile projects. They do not replace a production smoke test.

The separate N=0 suite checks the public experience with empty fixture data and with unavailable services. CI runs it after the regular browser suite. Run it locally when a public card, chart, observation lane, or empty state changes:

```bash
npm run test:e2e:n0
```

For migration work, test the ordered SQL locally with `npm run db:start` and `npm run db:reset`; Docker Engine must be running. Applying migrations to a hosted project is a separate owner-authorized release action. Do not run `supabase db push`. See the [Launch Checklist](docs/LAUNCH_CHECKLIST.md).

For documentation-only changes, check the affected claims against code and verify local links, anchors, and referenced commands. The [documentation index](docs/README.md) identifies maintained guidance and historical records. Run application checks when the change also affects code or executable examples.

## Secrets

Do not include real API keys, service role keys, screenshots with credentials, private dashboard URLs, or local filesystem paths in commits, issues, discussions, or pull requests.

## Community

Use GitHub Issues for concrete bugs or feature requests. Use GitHub Discussions for questions, setup help, and broader ideas.
