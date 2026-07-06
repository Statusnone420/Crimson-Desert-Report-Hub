<div align="center">

# Crimson Desert Report Hub

**An unofficial, privacy-first evidence board for Crimson Desert bug reports.**

<p>
  <a href="https://crimsonreporthub.com"><img alt="Live site" src="https://img.shields.io/badge/live-crimsonreporthub.com-B42318?style=for-the-badge&logo=vercel&logoColor=white"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/Statusnone420/Crimson-Desert-Report-Hub/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/Statusnone420/Crimson-Desert-Report-Hub?style=for-the-badge&color=0E7A5F"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Statusnone420/Crimson-Desert-Report-Hub?style=for-the-badge&logo=github&color=F2C94C"></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/Statusnone420/Crimson-Desert-Report-Hub?style=for-the-badge&color=5C8DFF">
</p>

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16.2-000000?style=for-the-badge&logo=nextdotjs&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0B1B13">
  <img alt="Vercel" src="https://img.shields.io/badge/Vercel-ready-000000?style=for-the-badge&logo=vercel&logoColor=white">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-visual%20smoke-45BA4B?style=for-the-badge&logo=playwright&logoColor=white">
</p>

<p>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions"><img alt="GitHub Discussions" src="https://img.shields.io/badge/Discussions-open-8957E5?style=for-the-badge&logo=github&logoColor=white"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/wiki"><img alt="GitHub Wiki" src="https://img.shields.io/badge/Wiki-live-0969DA?style=for-the-badge&logo=github&logoColor=white"></a>
  <img alt="No ads" src="https://img.shields.io/badge/no-ads-0E7A5F?style=for-the-badge">
  <img alt="No analytics trackers" src="https://img.shields.io/badge/no-analytics%20trackers-0E7A5F?style=for-the-badge">
  <img alt="Fan run" src="https://img.shields.io/badge/fan--run-unofficial-B42318?style=for-the-badge">
</p>

<a href="https://crimsonreporthub.com">
  <img alt="Clickable live website preview for Crimson Desert Report Hub" src="https://api.microlink.io/?url=https%3A%2F%2Fcrimsonreporthub.com&screenshot=true&meta=false&embed=screenshot.url" width="920">
</a>

<br>

<strong>Click the preview to open the live site.</strong>

</div>

## What This Is

Crimson Desert Report Hub turns scattered player bug reports into structured community evidence: public signals, anonymous direct reports, moderation-approved excerpts, and Pearl Abyss-ready dossiers.

It is not affiliated with Pearl Abyss, Reddit, X, Vercel, Supabase, Tavily, or OpenRouter.

## Core Flow

```text
public reports + community signals
        -> issue clusters
        -> moderation review
        -> public evidence board
        -> exportable dossier
```

## Principles

- Evidence before outrage.
- Anonymous report intake by default.
- No accounts, ads, analytics trackers, or public raw complaint feed.
- Paid integrations are optional and budget-capped.
- Official patch notes are treated as source metadata, not branding.

## Start Here

| Need | Link |
| --- | --- |
| Live app | [crimsonreporthub.com](https://crimsonreporthub.com) |
| Project docs | [docs/README.md](docs/README.md) |
| GitHub Wiki | [Wiki](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/wiki) |
| Wiki-ready source pages | [docs/wiki/Home.md](docs/wiki/Home.md) |
| Community questions | [Discussions](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions) |
| Discussion guide | [docs/DISCUSSIONS.md](docs/DISCUSSIONS.md) |
| Bugs and scoped work | [Issues](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/issues) |
| Privacy model | [docs/PRIVACY.md](docs/PRIVACY.md) |
| Production setup | [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) |
| Operations | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Security | [SECURITY.md](SECURITY.md) |

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

Create `.env.local` from [.env.local.example](.env.local.example) for full local runs. Never commit `.env.local`, API keys, passwords, dashboard screenshots with secrets, or local credential notes.

## Verification

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).
