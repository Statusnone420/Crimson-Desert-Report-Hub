# Crimson Desert Report Hub

[![CI](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/actions/workflows/ci.yml/badge.svg)](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/actions/workflows/ci.yml)

Unofficial, fan-run Crimson Desert issue tracker for turning scattered patch complaints into structured community evidence.

Live site: [crimsonreporthub.com](https://crimsonreporthub.com)

This project is not affiliated with Pearl Abyss, Reddit, X, Vercel, Supabase, Tavily, or OpenRouter.

## What It Does

- Watches public community signals from web search and optional Reddit API access.
- Reads the official Pearl Abyss announcements page to keep the active patch label and source link current.
- Uses a budget-capped AI extraction step to identify issue title, category, platform, confidence, and evidence URL.
- Clusters duplicate signals automatically.
- Lets players submit anonymous structured reports to strengthen clusters.
- Keeps raw submissions private unless a moderator approves a public excerpt.
- Compiles a Pearl Abyss-ready evidence dossier from automated signals and verified reports.

The public dashboard intentionally separates:

- `Community signals`: automated public signals that passed confidence rules.
- `Direct reports`: approved structured player reports.
- `Verified reports`: moderator-approved excerpts from direct reports.

## Privacy Posture

- No user accounts.
- No ads.
- No analytics trackers.
- No public raw complaint feed.
- No raw IP storage; the server stores only a salted one-way hash for rate limiting.
- Secrets live only in deployment environment variables, never in source control.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the full privacy model.

## Automation Safety

Automation is designed to fail closed:

- `AUTOMATION_BUDGET_USD_MONTHLY` is the single monthly cost knob.
- `0` disables paid search and paid LLM work.
- Tavily search is capped per run.
- OpenRouter extraction is configured with `openrouter/free`.
- Broad patch notes, reviews, benchmarks, and unclear `other` extractions are filtered before database writes.
- Scheduled scans can be paused from `/admin/source-monitor`.
- A protected source preview route can test live extraction without writing to the database.
- CI uses mocks only; it never calls Reddit, Tavily, OpenRouter, or Supabase production data.
- Public dashboard data and current patch metadata are server-cached for five minutes, then explicitly refreshed after real writes.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Supabase Postgres
- Vercel
- Vitest
- Playwright
- Optional Cloudflare Turnstile
- Optional Tavily, OpenRouter, and Reddit API integrations

## Repository Docs

- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md): one-page production launch checklist and human setup guide.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): deployment, environment variables, manual scanner controls, and human setup steps.
- [docs/PRIVACY.md](docs/PRIVACY.md): what is stored, what is public, and what is never collected.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute safely.
- [SECURITY.md](SECURITY.md): vulnerability reporting and secret-handling policy.
- [DESIGN.md](DESIGN.md): visual and UX direction.
- [PRODUCT.md](PRODUCT.md): product goals and boundaries.

Use [GitHub Discussions](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions) for setup help, community ideas, and non-sensitive questions. Use issues for concrete bugs or scoped feature requests.

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

Create `.env.local` from [.env.local.example](.env.local.example) when running the full app locally. Do not commit `.env.local` or any real credential file.

## Verification

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
```

Visual regression coverage:

```bash
npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).
