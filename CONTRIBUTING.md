# Contributing

Thanks for helping improve Crimson Desert Report Hub.

The code is public for transparency and review. Good contributions make the Hub easier to trust, safer to run, or clearer to read. The public docs describe the product contract. They do not promise that discovery, ranking, prompt or moderation details stay the same.

## Good contributions

- Bug fixes with tests.
- Accessibility improvements.
- Privacy and security hardening.
- Clearer documentation.
- Safer automation.
- UI polish that keeps the newspaper's identity and keeps reader and operator pages easy to read.

Keep source attribution and the unofficial disclaimer. The site uses credited Pearl Abyss imagery, and the project license does not cover third-party assets (see [NOTICE](NOTICE)). Do not add scraped private content, ad or analytics scripts, or features that publish unreviewed report text.

## Development

Verification uses the exact Node.js version in `.node-version` and npm 11.12.1. The shared command downloads and caches these tools without changing your system installation. For day-to-day work, install dependencies from the repository root:

```bash
npm ci
```

For UI work with invented data and no hosted database writes:

```bash
npm run preview:seed
npm run dev:preview
```

Open `http://127.0.0.1:3130`. The seed is local and ignored by Git. This preview runs the app on fixture data; it does not prove production data or provider health.

To use your own development database, copy `.env.local.example` to `.env.local`, fill in the required values, and run `npm run dev` (normally port 3000). That uses the services you configured, so point it at a project you own. Never commit `.env.local`.

## Verification before a pull request

GitHub runs the full gate on every pull request to `main`, on GitHub-hosted runners:

- `verify`: lint, unit tests, type checks and the production build (`npm run verify:core`).
- `browser`: the desktop, mobile and operator browser tests, the patch publication tests, the Twitch-history fixtures, the empty and unavailable states, and the Turnstile tests (`npm run verify:browser`). It runs on Windows because the screenshot baselines are drawn there; on macOS or Linux, the screenshot test can fail locally from font rendering alone.
- `migrations`: every migration in `supabase/migrations/`, applied in order on a throwaway local database, then the database tests in `supabase/tests/`.

Before you push, run the checks that cover your change, such as `npm test` or one Playwright spec. To run the whole gate on your own machine, stage your changes and run:

```bash
npm run verify
```

The local gate first rejects unstaged tracked changes and non-ignored untracked files, so it cannot pass with a fix the commit would leave out. It copies the staged files to a clean temporary folder, installs dependencies with `npm ci`, and runs lint, unit tests, type checks, the production build, the desktop, mobile and operator browser tests, the patch publication tests, the Twitch-history fixtures, the empty and unavailable states, and the Turnstile tests. It stops on the first failure and rejects a pass if source files changed while it ran. A full pass writes the ignored file `output/verification/latest.json`.

Other useful commands:

- `npm run verify:visible` runs the same gate with visible browser windows.
- `npm run test:e2e:ui` opens Playwright's test explorer on an isolated copy with invented data.
- `npm test` runs the unit tests only.

GitHub Actions calls the same script, so a local pass and a GitHub pass check the same things. The database tests run only on GitHub unless you start a local stack yourself.

## Pull requests from forks

Pull requests from forks are welcome for review and discussion, but they are not merged directly. A required check blocks the merge, the repository's tests do not run on fork branches, and preview builds need the maintainer's approval. When a change is accepted, the maintainer checks it locally and applies it on a branch in this repository, where the tests run, then credits you in that pull request and closes yours.

## Database changes

Write migrations as new files in `supabase/migrations/`. The `migrations` check applies the ordered SQL to a throwaway database on GitHub and runs the database tests. To test locally, use `npm run db:start` and `npm run db:reset` (Docker Engine must be running). Never link the local stack to a hosted project, and never run `supabase db push`. Applying a migration to the hosted database is a maintainer release step.

## Documentation changes

Check every claim against the code, and check local links, anchors and commands. The [documentation index](docs/README.md) lists the maintained pages.

## Secrets

Do not include real API keys, service role keys, screenshots with credentials, private dashboard URLs, or local file paths in commits, issues, discussions or pull requests.

## Community

- Website bugs and corrections: [Issues](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/issues/new/choose).
- Questions and ideas: [Discussions](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions).
- Reader guides: [the wiki](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/wiki).
- A private note about a page: the **Report a problem** button on the site.

GitHub posts are public and need a GitHub account. Game and account support belongs with [Pearl Abyss](https://support.pearlabyss.com/).

## License

By contributing, you agree that your contribution is licensed under the [GNU Affero General Public License v3.0](LICENSE) with the additional terms in [NOTICE](NOTICE).
