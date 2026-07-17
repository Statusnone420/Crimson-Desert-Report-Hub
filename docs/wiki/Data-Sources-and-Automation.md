# Data Sources and Automation

The hub is built around separate input registers. The public contract explains what each register means; the implementation details behind discovery and ranking remain intentionally changeable.

## Input registers

| Register | Public meaning |
| --- | --- |
| Official patch notes | Current patch context and the publisher's stated claims. |
| Structured player reports | Detailed, anonymous evidence reviewed before publication. |
| One-tap player responses | Patch- and platform-scoped signals such as *Still happening* or *Fixed for me*. |
| Public source leads | Links found through bounded public-web discovery and mapped into questions. |
| Patch observations | Reviewed coverage, reception, fix announcements, and community asks attached to the correct patch. |

The application keeps these registers separate in storage and in public language. A public link cannot create a report count, and a quiet board cannot create a fix claim.

## Confirmation semantics

- One network has one current response per issue and patch family.
- A later response updates the current stance rather than creating a second voter.
- Public totals are server-authored and refresh from the server.
- Stronger labels and meters require more than one distinct network signal.
- Exact-patch official claims remain attached to the patch that made them.

## Provider boundaries

- Tavily is the approved public-web discovery provider and stays within the documented monthly credit ceiling.
- High-value OpenRouter work is pinned to the approved budget-capped model lane.
- Routine moderation and dossier writing use free or deterministic fallback paths.
- Reddit API access and direct subreddit monitoring are permanently off.
- The protected preview route is deterministic-only and does not publish or write the scan ledger.

## Publishing boundary

Automation can find and classify candidates, but public publication still depends on the app's evidence, trust, moderation, and patch-scoping rules. Public scanner cards use question language. Raw candidates and rejected links stay private.

This page does not publish search packs, prompt text, ranking weights, or source-selection heuristics. Those are implementation details, not promises the public needs in order to audit the product's behavior.

## Maintainer controls

Authenticated maintainers can inspect scanner health, run a no-publish test, run an authorized capped scan, pause or resume scheduling, and review mapped leads. See the [Maintainer Runbook](Maintainer-Runbook) for the safe checklist.
