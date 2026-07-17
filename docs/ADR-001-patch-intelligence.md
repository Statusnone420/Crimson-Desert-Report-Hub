# ADR-001: From complaint verifier to patch intelligence publication

**Status:** Accepted and implemented; follow-up work remains<br>
**Date:** 2026-07-16<br>
**Deciders:** Anthony (owner)

> This is the public architecture record. It explains the evidence contract,
> product direction, and shipped public behavior without publishing private
> query packs, prompt templates, ranking weights, or moderation recipes.

## Context

The original hub was deliberately narrow: it was good at verifying structured
player complaints, but it had little useful context when a patch, official
claim, or community question changed what players needed to know. That created
an honest but incomplete public readout: a quiet evidence board could still
mean that the discovery lane had found context that was not appropriate to
count as a confirmed issue.

The product needed to become more useful on patch day without lowering its
evidence bar or presenting public-web discovery as proof.

## Decision

Keep the evidence pipeline strict and add clearly typed context around it:

1. Preserve the epistemic boundary: structured reports are evidence,
   confirmations are signals, external links are leads, and observations are
   context. These categories must not silently become interchangeable.
2. Make the readout patch-aware so current-patch claims, reports, observations,
   and community questions remain attached to the patch they describe.
3. Publish the claimed-fix scoreboard as the central artifact: an official
   claim is a starting point for player verification, not proof that the issue
   is resolved.
4. Keep automation bounded, auditable, and privacy-preserving. The public
   contract describes the source classes, labels, caps, and failure behavior;
   maintainer-only discovery recipes and decision weights remain outside this
   repository's public documentation.

## Options considered

### Option A: Loosen the existing issue funnel

This would increase volume, but it would blur the distinction between a player
report and surrounding patch commentary. It was rejected because more links
would not make the evidence model more trustworthy.

### Option B: Add typed context beside the evidence funnel

This was selected. It lets the site report what is happening around a patch
while keeping observations visibly separate from reports and confirmations.
It adds moderation and presentation work, but the boundary is understandable
to visitors and testable in the public read model.

### Option C: Add more external source families immediately

This was deferred. New providers would add quotas and failure modes before the
existing source and observation boundaries had been fully exercised.

## Public data semantics

| Register | What it means | What it does not mean |
| --- | --- | --- |
| Reports | Structured player-submitted accounts | A report is not independently verified fact |
| Signals | Anonymous confirmations or player reactions | A signal is not a population survey |
| Leads | Public links discovered by the scanner | A link is not evidence of the claim it discusses |
| Observations | Patch, press, or community context | Context is never counted as a confirmed issue |
| Official notes | First-party patch and support context | An official claim is not a player verdict |

## Shipped outcomes

The following parts of the decision are now implemented:

- the claimed-fix scoreboard and player-verdict loop;
- patch-aware scheduled discovery with an auditable budget boundary;
- a typed observation lane and a community-pulse lane;
- patch-scoped observation identity and current-patch public queries;
- explicit empty-state behavior for a board with no current evidence;
- public documentation that distinguishes promises and interfaces from
  private maintainer recipes.

The two observation migrations are committed in
[`supabase/migrations`](../supabase/migrations) and must remain an
owner-approved release step before code that writes observations is merged or
deployed to a new environment.

## Trade-offs

The central tension is integrity versus interestingness. The hub resolves it
by typing information rather than quietly lowering the evidence threshold.
The public site can say more during a patch cycle, but it must label whether a
visitor is looking at evidence, a signal, a lead, an observation, or an
official claim.

The cost is additional moderation and more copy that must remain precise. The
mitigation is a separate public read model, current-patch scoping, bounded
automation, and explicit owner controls for visibility.

## Follow-up

- Measure how visitors use the observation and scoreboard lanes across a full
  patch cycle.
- Consider public aggregate scanner telemetry only if it improves
  understanding without exposing private discovery logic.
- Improve coverage and extraction internally while keeping query composition,
  prompt design, ranking decisions, and moderation heuristics maintainer-only.
- Revisit additional source families only after the current evidence contract
  has proven stable in production.
