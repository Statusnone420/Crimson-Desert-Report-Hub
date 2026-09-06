# Product Notes

## Audience

Crimson Desert readers and players following news, expansions, official updates, and player-reported issues; moderators and contributors maintaining that record.

## Purpose

Crimson Desert Report Hub is an unofficial fan newspaper with a patch desk, player-report board, and source radar. Original articles and selected external coverage form the editorial layer. It keeps the player record separate:

1. **Reports are evidence.** Structured anonymous player reports are the strongest input. Raw submissions stay private; only counts, neutral summaries, and moderator-approved excerpts may become public.
2. **Confirmations are signals.** One-tap *Happening to me*, *Still happening*, and *Fixed for me* responses count what players say for an issue, platform, and patch family. They never certify a game-wide outcome.
3. **Scanner links are leads.** Tavily-discovered public links keep the radar alive and generate questions players can answer. A link remains a lead, not evidence or authority chrome.

Official Pearl Abyss patch notes provide canonical patch context and fix claims, while the hub remains independent and unofficial. A published player report does not automatically become a front-page story.

## Public Surfaces

| Surface | Purpose |
| --- | --- |
| Front page (`/`) | Newspaper lead, selected external coverage, official fix excerpts, player report totals, aggregate charts, and creator spotlight. |
| News (`/news`) and articles (`/articles/...`) | Original Hub reporting with source links, alongside clearly attributed external coverage. |
| Watch (`/watch`) | Official trailer and selected creator commentary; videos open at their original source. |
| Patches (`/patches`) | Current official patch, claimed fixes, player responses, and patch context. |
| Issues (`/issues`) | Current-patch reports, check-ins, reviewed leads, and fix-claim questions. |
| Observatory (`/observatory`) | Aggregate review and audience context, collection health, and source radar. |
| Report (`/report`) | Anonymous structured player intake with a review step before sending. |
| About (`/about`) and Privacy (`/privacy`) | Method, source boundaries, privacy, and official-support guidance. |
| Atom (`/feed.xml`) and RSS (`/rss.xml`) | Original Hub articles only; no external coverage, videos, scanner leads, or player submissions. |

`/scanner` remains the authenticated scanner workspace; anonymous visitors see the Observatory. `/operator` is the signed-in overview. These operational routes do not define the public newspaper's reading order.

## Editorial Boundary

- Original articles are maintained in the repository with publication dates and source references.
- External press and creator selections require a reviewed headline and excerpt, an allowed source, and a source publication date. They remain attributed outbound links.
- Scanner trust and editorial selection are separate. Discovery does not automatically publish newspaper coverage or add an article to the feeds.
- The creator source register supports reviewed videos; automatic YouTube discovery is not part of the current publication flow.
- Game imagery carries Pearl Abyss attribution and the site retains its unofficial disclaimer. The code license does not grant rights to third-party imagery.

## N=0 First

The site must work and feel complete with zero visitors and zero community input. Patch sync, official notes, scanner health, mapped lead questions, and claim clocks make the board useful on its own. Confirmation controls are calm invitations, not empty-state structure, and silence never turns green or becomes proof of a fix.

## Lifecycle Model

- A confidently mapped official fix claim stores its exact patch version and starts a clock attributed to that patch.
- Player answers made at or after that clock form the fix poll only while that exact claimed patch is current.
- A claim from `1.13.00` is never presented as a claim from `1.13.01`. A later exact patch needs its own matched claim.
- Only structured reports explicitly filed for that exact patch and submitted after the clock count as post-claim report evidence. Scanner links remain leads regardless of publication state.
- Public readouts are composed from current counts. They may say what players reported or tapped; they do not certify a game-wide truth.
- Maintainers may lock a displayed lifecycle state or immediately force a cluster public/hidden. Those interventions are explicit overrides, not automated verdicts.

## Product Principles

- Keep sources and publication dates with editorial reporting; show counts and evidence with player readouts.
- Keep original articles, external coverage, player reports, confirmations, scanner leads, and official claims visibly distinct.
- Never infer “fixed” from quiet.
- Make privacy and network-hash limitations obvious.
- Keep admin review focused on real exceptions.
- Use the newspaper for reading and discovery; keep issue and operator workflows clear and scannable.
- Stay useful at N=0.
- Keep Reddit API permanently off. Reddit pages may appear only through Tavily public-web discovery; promising thin results may receive bounded basic extraction after normalization to `old.reddit.com`.
- Keep public-web discovery at or below 1,000 monthly credits. Restrict higher-cost scanner enrichment and official fix-claim mapping to approved server-side automation under a hard $2 UTC-month software cap and per-request price ceilings.
- Keep routine report moderation and dossier prose on approved low-cost or deterministic fallback paths configured by maintainers.
- Use a dedicated OpenRouter key with a provider-side monthly reset limit of $2 or lower, verified manually by a maintainer because the repository cannot inspect that dashboard setting.

Public documentation should explain these guarantees and boundaries without treating the current discovery, ranking, prompt, or moderation implementation as a permanent public recipe.

## Non-Goals

- No claim of official status or Pearl Abyss affiliation.
- No verdict machine or official-verifier claim.
- No public unreviewed complaint feed.
- No accounts, ads, or analytics trackers.
- No raw IP storage in the application database.
- No direct Reddit API integration.
- No open-ended scraping, paid search upgrade, unapproved paid LLM model, or surprise API spend.

## Success Criteria

- The newspaper, issues page, and source radar remain complete and informative with no visitors.
- A visitor can distinguish Hub reporting, external coverage, evidence, player signals, scanner leads, and official claims.
- The active patch label and official source link update without code changes.
- Players can report or confirm an issue without creating an account.
- Counts remain honest at one response. Confirmation-driven labels and meters escalate only when the driving tally reaches at least two distinct network hashes; a structured report is evidence immediately and does not need a second network.
- Admins can handle exceptions, change visibility immediately, and compile a dossier without becoming the daily lifecycle engine.
- Contributors can audit the privacy, cost, and source model publicly.
