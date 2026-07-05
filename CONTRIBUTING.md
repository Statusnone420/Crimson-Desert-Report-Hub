# Contributing

Thanks for helping improve Crimson Desert Report Hub.

## Good Contributions

- Bug fixes with tests.
- Accessibility improvements.
- Privacy/security hardening.
- Clearer documentation.
- Safer automation heuristics.
- UI polish that keeps the tracker operational and readable.

Avoid adding official Crimson Desert artwork, logos, scraped private content, ad/analytics scripts, or features that publish unreviewed raw report text.

## Development

```bash
npm install
npm test
npm run build
```

For app work, copy `.env.local.example` to `.env.local` and fill local-only values. Never commit `.env.local`.

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

## Secrets

Do not include real API keys, service role keys, screenshots with credentials, private dashboard URLs, or local filesystem paths in commits, issues, discussions, or pull requests.

## Community

Use GitHub Issues for concrete bugs or feature requests. Use GitHub Discussions for questions, setup help, and broader ideas.
