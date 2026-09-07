# Data Sources and Automation

The hub is built around separate input registers. The public contract explains what each register means; the implementation details behind discovery and ranking remain intentionally changeable.

## Input registers

| Register | Role |
| --- | --- |
| Official patch notes | Current patch context and the publisher's stated claims. |
| Structured player reports | Detailed, anonymous evidence reviewed before publication. |
| One-tap player responses | Patch- and platform-scoped signals such as *Still happening* or *Fixed for me*. |
| Public source leads | Links found through bounded public-web discovery and mapped into questions. |
| Scanner context archive | Patch-scoped diagnostic observations retained for authenticated review; they no longer supply front-page articles. |
| Original reports | First-party, source-backed articles published by the Report Hub. |
| Selected coverage | Manually reviewed official, press, and creator links that remain outbound coverage. |
| Platform context | Aggregate Steam review, Twitch audience, and IGDB game metadata when configured. |

The application keeps these registers separate in storage and in public language. A public link cannot create a report count, and a quiet board cannot create a fix claim.

Original reports and selected coverage also stay separate. The Atom and RSS feeds contain original Report Hub articles only. Selected external links, Watch videos, scanner leads, issues, and Observatory data do not enter those feeds.

## Confirmation semantics

- One network has one current response per issue and patch family.
- A later response updates the current stance rather than creating a second voter.
- Public totals are server-authored and refresh from the server.
- Stronger labels and meters require more than one distinct network signal.
- Exact-patch official claims remain attached to the patch that made them.

## Provider boundaries

- Tavily is the approved public-web discovery provider and stays within the documented monthly credit ceiling.
- High-value OpenRouter work defaults to GPT-5.6 Luna Standard on the first-party OpenAI provider. The saved budget defaults to $0.50 and is configurable up to the $1 UTC-month software ceiling, with model-specific request price ceilings. Luna Flex and DeepSeek V4 Flash rollback are explicit scanner presets, never automatic fallbacks. Luna requests are pinned to OpenAI with provider fallback disabled; DeepSeek rollback requests may route among eligible zero-data-retention providers under the model's price ceiling.
- Before inference, the scanner inspects the dedicated OpenRouter key's limit, remaining credit, and monthly usage. It requires a monthly or lifetime limit of $1 or lower; daily, weekly, unlimited, or unverifiable limits block AI requests. These are setup requirements, not claims about a deployed account.
- Routine moderation and dossier writing use free or deterministic fallback paths.
- Reddit API access and direct subreddit monitoring are permanently off.
- The protected source preview runs at most two live Tavily queries, then applies deterministic filtering with LLM calls disabled. It does not publish or write the scan ledger. Live search results can vary between runs.
- Optional Steam collection supplies aggregate review sentiment and stores service-role-only Steam-connected player snapshots. Review text and hashed provider identifiers stay private. Player snapshots are not currently rendered publicly and exclude offline play and other platforms.
- Optional Twitch and IGDB collection supplies aggregate live-audience context and public game metadata. It is provider context, not player evidence.
- Newspaper publishing uses a separate reviewed source list. Only approved hosts and verified creator videos can appear, and scanner discovery cannot publish into it automatically.

## Publishing boundary

Automation can find and classify candidates, but public lead publication still depends on the app's evidence, trust, moderation, and patch-scoping rules. The public issue board presents eligible links as leads and watchlist questions. Raw candidates and rejected links stay private. Original articles and selected newspaper coverage require a separate maintained editorial decision.

This page does not publish search packs, prompt text, ranking weights, or source-selection heuristics. Those are implementation details, not promises the public needs in order to audit the product's behavior.

## Maintainer controls

Authenticated maintainers can inspect scanner health, run a no-publish test, run an authorized capped scan, pause or resume scheduling, and review mapped leads. See the [Maintainer Runbook](Maintainer-Runbook.md) for the safe checklist.
