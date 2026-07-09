# Crimson Desert Report Hub

Crimson Desert Report Hub is an unofficial confirmation board and source radar for the current state of Crimson Desert.

It keeps three things separate: structured reports are evidence, anonymous one-tap confirmations are player signals, and scanner-discovered public links are leads. Official Pearl Abyss notes provide patch context and fix claims. The hub counts what each register says; it does not issue game-wide verdicts.

The dashboard, issue board, and source radar are designed to stay complete and useful with zero visitors. Patch sync, official notes, scanner health, mapped lead questions, and exact-patch fix-claim provenance carry the site at N=0.

## Quick Links

| Destination | Link |
| --- | --- |
| Live site | [crimsonreporthub.com](https://crimsonreporthub.com) |
| Source code | [GitHub repository](https://github.com/Statusnone420/Crimson-Desert-Report-Hub) |
| Community help | [GitHub Discussions](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/discussions) |
| Bugs and scoped work | [GitHub Issues](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/issues) |
| Privacy details | [docs/PRIVACY.md](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md) |

## What The Hub Does

- Shows current official patch context and claim clocks.
- Accepts anonymous structured player reports as evidence.
- Accepts anonymous one-tap confirmations as patch- and platform-scoped signals.
- Uses capped Tavily web discovery to find public links and map them into source-radar questions; promising thin Reddit results may receive a bounded basic context read through `old.reddit.com`.
- Keeps raw direct reports, network hashes, and rejected lead details private.
- Lets maintainers review reports, handle real exceptions, and change cluster visibility immediately.
- Compiles a practical evidence dossier.

## What The Hub Does Not Do

- It does not claim affiliation with Pearl Abyss.
- It does not turn scanner links, quiet periods, or a timer into proof.
- It does not require player accounts or email addresses.
- It does not include ads or analytics trackers.
- It does not store raw IP addresses in the application database.
- It does not use Reddit API; Tavily may find public Reddit pages through ordinary web discovery.
- It does not use paid Tavily capacity or unapproved LLM models. High-value scanner/claim work is pinned to DeepSeek V4 Flash under a $2 UTC-month software cap; routine AI stays free or deterministic.

## Wiki Map

- [Getting Started](Getting-Started): where players, contributors, and maintainers should begin.
- [Data Sources and Automation](Data-Sources-and-Automation): how reports, confirmations, scanner leads, official context, and capped provider controls fit together.
- [Privacy and Moderation](Privacy-and-Moderation): what is public, what stays private, and how network-hash protections work.
- [Maintainer Runbook](Maintainer-Runbook): routine checks and release-safe operating steps.
