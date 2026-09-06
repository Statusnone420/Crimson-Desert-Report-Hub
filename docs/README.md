# Documentation

This is the canonical documentation map for Crimson Desert Report Hub. The README is the visual front door; these pages hold the product, design, development, and operating detail.

Public documentation explains the promises people need to evaluate: what the hub shows, what it keeps private, how contributions are checked, and which provider or deployment boundaries matter. It intentionally does not publish private query packs, prompt templates, ranking weights, moderation heuristics, or other implementation recipes that are part of the maintainer's operating knowledge.

## Read this first

1. [README](../README.md) — what the hub is and where to start.
2. [Product Notes](../PRODUCT.md) — audience, evidence model, principles, and non-goals.
3. [Architecture](ARCHITECTURE.md) — routes, input registers, persistence, and automation flow.
4. [Privacy](PRIVACY.md) — what is collected, what is public, and how abuse controls work.

## Current truth

- [Product Notes](../PRODUCT.md) describe the implemented product and evidence boundaries; new product decisions remain the owner's.
- [Design Notes](../DESIGN.md) describe the current newspaper and operator interface. Earlier plans do not override the implemented design.
- [Architecture](ARCHITECTURE.md) maps current routes and data boundaries. Code, tests, and configuration verify implementation claims.
- [State of Play](NEXT-STEPS.md) records the current handoff and follow-up work. It is not proof of deployment health or applied migrations.

No document replaces a fresh check of the target environment before a release. Historical records below retain their original context rather than serving as current requirements.

## Public project docs

| Document | Use it for |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | A code-oriented map of the public surfaces, data lanes, scheduler, and provider boundaries. |
| [Launch Checklist](LAUNCH_CHECKLIST.md) | First-time provider setup, authorized migration workflow, production smoke test, and release checks. |
| [Operations Guide](OPERATIONS.md) | Environment variables, scan controls, budgets, admin actions, optional Steam/Twitch/IGDB collection, and safe live operations. |
| [Privacy](PRIVACY.md) | Public/private data boundaries, network hashes, confirmations, evidence links, and third parties. |
| [Discussion Guide](DISCUSSIONS.md) | Where questions, bug reports, and sensitive material belong on GitHub. |
| [State of Play](NEXT-STEPS.md) | A living maintainer handoff for the current release posture and next decisions. |

## Focused maintainer references

- [Scheduler Worker](../cloudflare/scanner-cron/README.md) — the Cloudflare wake-up trigger and its deployment commands.
- [Scanner bake-off](../scripts/bakeoff/README.md) — evidence requirements and paid live-query comparison.
- [Environment template](../.env.local.example) — placeholder values for local configuration; never put real credentials in it.

## Repository policy

| Document | Use it for |
| --- | --- |
| [Product Notes](../PRODUCT.md) | Product truth, non-goals, and success criteria. |
| [Design Notes](../DESIGN.md) | Visual language, information hierarchy, and accessibility constraints. |
| [Contributing](../CONTRIBUTING.md) | Local development, verification, review expectations, and scope boundaries. |
| [Security Policy](../SECURITY.md) | Vulnerability reporting and secret handling. |
| [Agent rules](../AGENTS.md) and [Claude guidance](../CLAUDE.md) | Coding and database-safety instructions; follow the host's precedence rules. |
| [Pull request template](../.github/PULL_REQUEST_TEMPLATE.md) | Review summary, verification, and safety checklist. |
| [License](../LICENSE) | The current Apache 2.0 terms. |

## Wiki-ready source

The files under [`docs/wiki`](wiki/Home.md) are maintained repository sources for the GitHub Wiki. Their sibling `.md` links work in this repository. When copying a page to the Wiki, use the corresponding Wiki page names for those links. Editing these sources does not publish or synchronize the hosted Wiki.

- [Wiki home](wiki/Home.md)
- [Getting Started](wiki/Getting-Started.md)
- [Data Sources and Automation](wiki/Data-Sources-and-Automation.md)
- [Privacy and Moderation](wiki/Privacy-and-Moderation.md)
- [Maintainer Runbook](wiki/Maintainer-Runbook.md)
- [Wiki sidebar](wiki/_Sidebar.md)

## Historical records

These committed records explain earlier decisions or preserve planning evidence. Their status notes distinguish them from maintained guidance:

| Record | Scope |
| --- | --- |
| [Patch Intelligence ADR](ADR-001-patch-intelligence.md) | July 2026 decision behind the patch-aware evidence and observation lanes. |
| [Phase 4 target](PHASE-4-TARGET.md) | Operator-console planning contract; not a current route or design inventory. |
| [Phase 4 inventory](PHASE-4-ADMIN-INVENTORY.md) | Historical control audit with source locations from that sweep. Recheck code before relying on a finding. |
| [Share-card proposal](share-card/PROPOSAL.md) | Earlier presentation decision and asset recipe; current metadata lives in code. |

Local planning files, ignored tooling output, and mockups are not maintained product authority. Font and asset license notices remain attached to their sources; the [share-card font license](share-card/fonts/LICENSE.md) is one such notice.

## Documentation rules

- Describe observed behavior, not intended behavior, unless a page is explicitly a proposal.
- Keep reports, confirmations, scanner leads, and official claims separate in every public explanation.
- Never publish secrets, raw report text, private source candidates, network hashes, or private dashboard details.
- Update the docs map when adding a public runbook or changing a route, provider, migration workflow, or budget boundary.
