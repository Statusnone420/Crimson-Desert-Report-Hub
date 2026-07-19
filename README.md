<div align="center">

# Crimson Desert Report Hub

**An unofficial patch brief, evidence board, and public-source radar for Crimson Desert.**

<p align="center">
  <a href="https://crimsonreporthub.com" title="Open the live site"><img alt="Live site" src="public/readme/badges/plaques/crimson-dev.svg" width="120"></a>&nbsp;
  <a href="docs/README.md" title="Read the project documentation"><img alt="Project documentation" src="public/readme/badges/plaques/adventurer.svg" width="120"></a>&nbsp;
  <a href="docs/wiki/Home.md" title="Wiki-ready pages"><img alt="Wiki" src="public/readme/badges/plaques/explorer.svg" width="120"></a>&nbsp;
  <a href="PRODUCT.md" title="Product notes"><img alt="Product" src="public/readme/badges/plaques/scout.svg" width="120"></a>&nbsp;
  <a href="DESIGN.md" title="Design notes"><img alt="Design" src="public/readme/badges/plaques/documentor.svg" width="120"></a>
</p>

<p align="center">
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/actions/workflows/ci.yml" title="Continuous integration"><img alt="CI" src="public/readme/badges/plaques/battle-tested.svg" width="120"></a>&nbsp;
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/issues" title="Browse issues"><img alt="Issues" src="public/readme/badges/plaques/warrior.svg" width="120"></a>&nbsp;
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/pulls" title="Pull requests"><img alt="Pull requests" src="public/readme/badges/plaques/team-player.svg" width="120"></a>&nbsp;
  <a href="CONTRIBUTING.md" title="Contribute to the project"><img alt="Contributing" src="public/readme/badges/plaques/contributor.svg" width="120"></a>&nbsp;
  <a href="docs/OPERATIONS.md" title="Operations guide"><img alt="Operations" src="public/readme/badges/plaques/resourceful.svg" width="120"></a>
</p>

<p align="center">
  <a href="SECURITY.md" title="Security policy"><img alt="Security" src="public/readme/badges/plaques/survivor.svg" width="120"></a>&nbsp;
  <a href="docs/PRIVACY.md" title="Privacy model"><img alt="Privacy" src="public/readme/badges/plaques/guardian.svg" width="120"></a>&nbsp;
  <a href="LICENSE" title="Read the current license"><img alt="Apache 2.0 license" src="public/readme/badges/plaques/supporter.svg" width="120"></a>&nbsp;
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions" title="Community discussions"><img alt="Discussions" src="public/readme/badges/plaques/fan.svg" width="120"></a>&nbsp;
  <a href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub/stargazers" title="Star the repository"><img alt="Star the repository" src="public/readme/badges/plaques/legend.svg" width="120"></a>
</p>

<a href="https://crimsonreporthub.com" title="Open the live site">
  <img alt="Screenshot of the Crimson Desert Report Hub live site" src="https://api.microlink.io/?url=https%3A%2F%2Fcrimsonreporthub.com&screenshot=true&meta=false&embed=screenshot.url" width="820">
</a>

</div>

## What this is

Crimson Desert Report Hub is a fan-run, privacy-first way to read the current patch situation without pretending that every signal is a fact. It combines official patch context, anonymous structured reports, one-tap player responses, and carefully reviewed public-source leads.

The site keeps those inputs visibly separate:

| Register | What it means | What it does not mean |
| --- | --- | --- |
| **Reports** | Structured player accounts of a problem. | Not a public raw-complaint feed. |
| **Player taps** | Anonymous responses such as *I have this too*, *Still happening*, or *Fixed for me*. | Not identity, consensus, or a game-wide verdict. |
| **Radar leads** | Public links found and filtered by the scanner. | Not evidence just because a link is published. |
| **Official notes** | Pearl Abyss patch metadata and claimed fixes. | Not proof that every player received the same outcome. |

The board is useful even at **N=0**: a quiet board is a real readout, not a made-up number.

## On the site

| Surface | Use it for |
| --- | --- |
| [Patch Brief](https://crimsonreporthub.com/) | Read the current patch, the right-now summary, the fix-claim scoreboard, community pulse, and source coverage. |
| [Issues](https://crimsonreporthub.com/issues) | Inspect issue readouts, evidence counts, reviewed links, and player response controls. |
| [Report](https://crimsonreporthub.com/report) | Submit an anonymous structured report with patch, platform, severity, frequency, reproduction, hardware, and optional evidence. |
| [Scanner](https://crimsonreporthub.com/scanner) | See source health, mapped radar questions, and the public publishing boundary. |
| [About](https://crimsonreporthub.com/about) | Read the privacy posture, evidence model, and official-support guidance. |

## What counts

- A structured report is evidence after moderation; raw submissions remain private.
- A confirmation is a player signal. One network has one current stance per issue and patch family, and a later tap updates that stance.
- A scanner URL is a lead. Public links are filtered, mapped into questions, and never promoted to player evidence by automation alone.
- A confidently mapped official fix is attached to its exact patch version. Later patches do not inherit the old claim.
- Stronger confirmation labels and meters require multiple distinct network hashes; one response is still shown literally.
- Silence, elapsed time, and an empty queue never become “fixed.”

## Privacy and providers

- No accounts, email collection, ads, or analytics trackers.
- Raw IP addresses are not stored. The server uses salted one-way network hashes for deduplication and abuse limits; hashes and individual confirmation rows are never public.
- The optional save/config helper reads selected files in the browser and submits only the sanitized text a visitor chooses to keep.
- Reddit API access is permanently off. Public Reddit pages may appear only through ordinary Tavily web discovery and bounded context extraction.
- Tavily discovery is capped at 1,000 monthly credits, including scheduled search and bounded extraction work.
- High-value scanner enrichment and official fix-claim mapping run through budget-capped server-side automation. Exact model routing and fallback recipes are maintainer configuration, not part of the public contract.
- The high-value OpenRouter lane is software-capped at `$2` per UTC month. Provider-side key limits are a separate maintainer setup check.

Read the full policy in [Privacy](docs/PRIVACY.md), [Security](SECURITY.md), and [Data Sources and Automation](docs/wiki/Data-Sources-and-Automation.md).

## Find your way around

| Need | Start here |
| --- | --- |
| Product model and non-goals | [PRODUCT.md](PRODUCT.md) |
| System shape and data flow | [Architecture](docs/ARCHITECTURE.md) |
| Design language and accessibility | [DESIGN.md](DESIGN.md) |
| Documentation index | [docs/README.md](docs/README.md) |
| Production setup | [Launch Checklist](docs/LAUNCH_CHECKLIST.md) |
| Day-to-day operation | [Operations Guide](docs/OPERATIONS.md) |
| Privacy and moderation | [Privacy](docs/PRIVACY.md) |
| Contribution workflow | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security reporting | [SECURITY.md](SECURITY.md) |
| Wiki-ready public pages | [docs/wiki/Home.md](docs/wiki/Home.md) |

## Run it locally

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

The app can render a safe empty public shell without provider credentials, but full local behavior needs a server-side Supabase URL/key. Keep real values in `.env.local` or provider dashboards; never commit them.

To preview the site against an invented, repo-ignored dataset (no Supabase, no writes anywhere), generate a deterministic production-shaped seed and boot the in-memory harness:

```bash
npm run preview:seed -- --leads 60 --reports 2 --taps 8 --days 14
npm run dev:preview   # http://127.0.0.1:3130
```

The seed uses the exact row shapes the live scanner writes, so anything previewed reproduces once real data reaches the same scale. Same `--seed` in, same dataset out.

For a normal development check:

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
npm run test:e2e:n0
```

If Playwright cannot find a browser on your machine, install the repository's browser runtime with `npx playwright install chromium` and rerun the E2E command from this repository. See [Contributing](CONTRIBUTING.md) for the pull-request gate.

## How it runs

Vercel serves the Next.js application and its protected routes. A small Cloudflare Worker in [`cloudflare/scanner-cron`](cloudflare/scanner-cron) wakes `/api/cron/keepalive` hourly; the application decides whether a scheduled scan is allowed, paused, recent, or in a patch burst. The Worker has no public fetch endpoint and holds only `CRON_SECRET`.

Supabase migrations are committed in [`supabase/migrations`](supabase/migrations). Migration filenames are the source of truth for history. Use the Supabase CLI from the repository when linking, listing, applying, or repairing migration history; do not invent empty alias migrations or edit the remote schema-history table by hand.

## License

The repository uses the [Apache License 2.0](LICENSE). Crimson Desert Report Hub is unofficial and is not affiliated with Pearl Abyss, Reddit, X, Vercel, Supabase, Tavily, OpenRouter, or Cloudflare. Product names and third-party marks belong to their respective owners.
