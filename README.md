<div align="center">

# Crimson Desert Report Hub

**An unofficial, privacy-first confirmation board and source radar for Crimson Desert issues.**

<p align="center">
  <a href="https://crimsonreporthub.com" title="Open the live site"><img alt="Crimson Dev plaque linking to the live site" src="public/readme/badges/plaques/crimson-dev.svg" width="150"></a>
  <a href="docs/README.md" title="Project documentation"><img alt="Adventurer plaque linking to project docs" src="public/readme/badges/plaques/adventurer.svg" width="150"></a>
  <a href="docs/wiki/Home.md" title="Wiki source pages"><img alt="Explorer plaque linking to the wiki source" src="public/readme/badges/plaques/explorer.svg" width="150"></a>
  <a href="PRODUCT.md" title="Product notes and principles"><img alt="Scout plaque linking to product notes" src="public/readme/badges/plaques/scout.svg" width="150"></a>
  <a href="DESIGN.md" title="Design system notes"><img alt="Documentor plaque linking to design notes" src="public/readme/badges/plaques/documentor.svg" width="150"></a>
</p>

<p align="center">
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/actions/workflows/ci.yml" title="CI runs"><img alt="Battle Tested plaque linking to CI" src="public/readme/badges/plaques/battle-tested.svg" width="150"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/issues" title="Bugs and scoped work"><img alt="Warrior plaque linking to issues" src="public/readme/badges/plaques/warrior.svg" width="150"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pulls" title="Open pull requests"><img alt="Team Player plaque linking to pull requests" src="public/readme/badges/plaques/team-player.svg" width="150"></a>
  <a href="CONTRIBUTING.md" title="How to contribute"><img alt="Contributor plaque linking to contributing guide" src="public/readme/badges/plaques/contributor.svg" width="150"></a>
  <a href="docs/OPERATIONS.md" title="Operations runbook"><img alt="Resourceful plaque linking to operations docs" src="public/readme/badges/plaques/resourceful.svg" width="150"></a>
</p>

<p align="center">
  <a href="SECURITY.md" title="Security policy"><img alt="Survivor plaque linking to security policy" src="public/readme/badges/plaques/survivor.svg" width="150"></a>
  <a href="docs/PRIVACY.md" title="Privacy model"><img alt="Guardian plaque linking to the privacy model" src="public/readme/badges/plaques/guardian.svg" width="150"></a>
  <a href="LICENSE" title="MIT license"><img alt="Supporter plaque linking to the MIT license" src="public/readme/badges/plaques/supporter.svg" width="150"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions" title="Community questions"><img alt="Fan plaque linking to discussions" src="public/readme/badges/plaques/fan.svg" width="150"></a>
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/stargazers" title="Star the repo"><img alt="Legend plaque linking to stargazers" src="public/readme/badges/plaques/legend.svg" width="150"></a>
</p>

<a href="https://crimsonreporthub.com">
  <img alt="Clickable live website preview for Crimson Desert Report Hub" src="https://api.microlink.io/?url=https%3A%2F%2Fcrimsonreporthub.com&screenshot=true&meta=false&embed=screenshot.url" width="920">
</a>

<br>

<strong>Click the preview to open the live site.</strong>

</div>

## What This Is

Crimson Desert Report Hub keeps the current patch situation readable without pretending to know more than its inputs support. Structured anonymous reports are evidence, one-tap anonymous confirmations are player signals, and scanner-discovered public links are leads that generate questions—not proof.

The dashboard, issue board, and source radar are designed to remain complete and useful with zero visitors. Official patch context, scanner health, mapped lead questions, and exact-patch fix-claim provenance carry the site at N=0; community input adds resolution when it exists.

It is not affiliated with Pearl Abyss, Reddit, X, Vercel, Supabase, Tavily, or OpenRouter.

## Core Flow

```text
official patch context + scanner leads
                    -> issue questions
structured reports -> evidence counts
confirmation taps  -> player-signal counts
                    -> one count-backed readout, never a verdict
```

## Principles

- Evidence before outrage.
- Reports are evidence; confirmations are signals; scanner links are leads.
- Anonymous report and confirmation intake by default.
- No verdicts from quiet, elapsed time, or scanner links.
- No accounts, ads, analytics trackers, or public raw complaint feed.
- No raw IP storage; network hashes stay server-side for deduplication and abuse limits.
- Reddit API is permanently off. Tavily may discover public Reddit pages through normal web search and may perform bounded basic extraction against `old.reddit.com` for thin, promising results.
- Tavily is capped at 1,000 monthly credits. High-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash` under a hard $2 UTC-month software cap and per-request price ceilings.
- Routine report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback.
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

Create `.env.local` from [.env.local.example](.env.local.example) for full local runs. The example caps high-value OpenRouter automation at `$2` per UTC month and Tavily at 1,000 monthly credits. Before enabling automation, configure a dedicated OpenRouter key with a provider-side monthly reset limit of `$2` or lower and verify that dashboard setting manually; the repository cannot verify it for you. Never commit `.env.local`, API keys, passwords, dashboard screenshots with secrets, or local credential notes.

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
