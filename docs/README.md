# Documentation

Crimson Desert Report Hub is documented in small, purpose-specific files so the README can stay readable.

## Current Product Model

The current owner-approved model is the **Confirmation Board**: reports are evidence, anonymous confirmations are player signals, and scanner links are leads. The site must remain useful at N=0, never infer a fix from silence, and keep Reddit API permanently off. Tavily discovery stays within 1,000 monthly credits; high-value scanner/claim work uses only budget-capped DeepSeek V4 Flash, while routine AI work stays on free models or deterministic fallback. [Product Notes](../PRODUCT.md) is the concise public contract; the owner-approved [Confirmation Board design](superpowers/specs/2026-07-09-confirmation-board-design.md) is the detailed design record.

Older dated specs and plans under `docs/superpowers/` are historical records. Their banners identify superseded guidance; do not execute an older checklist when it conflicts with the Confirmation Board design or current repository instructions.

## Public Project Docs

| Document | Use it for |
| --- | --- |
| [State of Play & Next Steps](NEXT-STEPS.md) | Owner's resume-cold note: current state, ranked backlog, health check. Read first after time away. |
| [Launch Checklist](LAUNCH_CHECKLIST.md) | Production setup, required services, first run, and final verification. |
| [Operations Guide](OPERATIONS.md) | Environment variables, confirmation/scanner controls, deployment behavior, and safe live previews. |
| [Privacy](PRIVACY.md) | What the app stores, what it shows publicly, and what it avoids collecting. |
| [Discussion Guide](DISCUSSIONS.md) | How to use GitHub Discussions without leaking secrets or turning questions into issue noise. |

## Repository Docs

| Document | Use it for |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Contribution expectations and verification commands. |
| [Security](../SECURITY.md) | Vulnerability reporting and secret-handling policy. |
| [Design Notes](../DESIGN.md) | Visual direction and UI constraints. |
| [Product Notes](../PRODUCT.md) | Audience, purpose, principles, non-goals, and success criteria. |

## Wiki Source

The GitHub Wiki is a separate repository behind the scenes. The files in [docs/wiki](wiki/Home.md) are polished wiki-ready source pages:

- [Home](wiki/Home.md)
- [Getting Started](wiki/Getting-Started.md)
- [Data Sources and Automation](wiki/Data-Sources-and-Automation.md)
- [Privacy and Moderation](wiki/Privacy-and-Moderation.md)
- [Maintainer Runbook](wiki/Maintainer-Runbook.md)
- [Sidebar](wiki/_Sidebar.md)

Copy those pages into the GitHub Wiki when you want the public wiki to match the repository docs.
