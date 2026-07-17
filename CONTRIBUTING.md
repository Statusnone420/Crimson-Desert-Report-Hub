# Contributing

Thanks for helping improve Crimson Desert Report Hub.

The project is public for transparency and review. Contributions should make the product easier to trust, safer to operate, or clearer to use. Public docs describe the product contract; they do not promise that private discovery, ranking, prompt, or moderation recipes will remain stable or be documented.

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
npm run build
npm test
```

For app work, copy `.env.local.example` to `.env.local` and fill local-only values. Never commit `.env.local`.

## Verification Before Pull Request

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e:n0
```

If the UI changes, also run:

```bash
npm run test:e2e

The N=0 suite protects the empty public experience. Run it whenever a public card, chart, observation lane, or empty state changes.

For migration work, review the SQL file and its ordering in supabase/migrations. Applying it to a hosted project is a separate owner-authorized release action; do not use a pull request as implicit database permission.
```

## Secrets

Do not include real API keys, service role keys, screenshots with credentials, private dashboard URLs, or local filesystem paths in commits, issues, discussions, or pull requests.

## Community

Use GitHub Issues for concrete bugs or feature requests. Use GitHub Discussions for questions, setup help, and broader ideas.
