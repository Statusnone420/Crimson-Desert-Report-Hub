# Documentation

This is the canonical map for Crimson Desert Report Hub. The README is the public front door; these pages explain the product contract, system boundaries, release work, and maintainer routines without making the repository history the user manual.

Public documentation explains the promises people need to evaluate: what the hub shows, what it keeps private, how contributions are checked, and which provider or deployment boundaries matter. It intentionally does not publish private query packs, prompt templates, ranking weights, moderation heuristics, or other implementation recipes that are part of the maintainer's operating knowledge.

## Read this first

1. [README](../README.md) — what the hub is and how to run it.
2. [Product Notes](../PRODUCT.md) — audience, evidence model, principles, and non-goals.
3. [Architecture](ARCHITECTURE.md) — routes, input registers, persistence, and automation flow.
4. [Privacy](PRIVACY.md) — what is collected, what is public, and how abuse controls work.

## Public project docs

| Document | Use it for |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | A code-oriented map of the public surfaces, data lanes, scheduler, and provider boundaries. |
| [Launch Checklist](LAUNCH_CHECKLIST.md) | First-time provider setup, authorized migration workflow, production smoke test, and release checks. |
| [Operations Guide](OPERATIONS.md) | Environment variables, scan controls, budgets, admin actions, optional Steam player collection, and safe live operations. |
| [Privacy](PRIVACY.md) | Public/private data boundaries, network hashes, confirmations, evidence links, and third parties. |
| [Discussion Guide](DISCUSSIONS.md) | Where questions, bug reports, and sensitive material belong on GitHub. |
| [State of Play](NEXT-STEPS.md) | A living maintainer handoff for the current release posture and next decisions. |
| [Patch Intelligence ADR](ADR-001-patch-intelligence.md) | The historical decision record behind patch-aware intelligence and the observation lane. |

## Repository policy

| Document | Use it for |
| --- | --- |
| [Product Notes](../PRODUCT.md) | Product truth, non-goals, and success criteria. |
| [Design Notes](../DESIGN.md) | Visual language, information hierarchy, and accessibility constraints. |
| [Contributing](../CONTRIBUTING.md) | Local development, verification, review expectations, and scope boundaries. |
| [Security Policy](../SECURITY.md) | Vulnerability reporting and secret handling. |
| [License](../LICENSE) | The current Apache 2.0 terms. |

## Wiki-ready source

The files under [`docs/wiki`](wiki/Home.md) are public, copyable pages for the GitHub Wiki. They intentionally use stable links and plain language so the wiki can be updated without exposing private operator notes.

- [Wiki home](wiki/Home.md)
- [Getting Started](wiki/Getting-Started.md)
- [Data Sources and Automation](wiki/Data-Sources-and-Automation.md)
- [Privacy and Moderation](wiki/Privacy-and-Moderation.md)
- [Maintainer Runbook](wiki/Maintainer-Runbook.md)
- [Wiki sidebar](wiki/_Sidebar.md)

## Historical records

Internal planning artifacts and agent handoffs are intentionally not part of the public documentation tree. The maintained public contract is the README, Product Notes, Architecture, Operations, Privacy, and wiki-ready pages listed above.

## Documentation rules

- Describe observed behavior, not intended behavior, unless a page is explicitly a proposal.
- Keep reports, confirmations, scanner leads, and official claims separate in every public explanation.
- Never publish secrets, raw report text, private source candidates, network hashes, or private dashboard details.
- Update the docs map when adding a public runbook or changing a route, provider, migration workflow, or budget boundary.
