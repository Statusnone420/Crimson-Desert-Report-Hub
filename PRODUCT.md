# Product Notes

## Audience

Crimson Desert players, moderators, and technically minded volunteers who want a calm, current readout of patch issues without turning scattered complaints into verdicts.

## Purpose

Crimson Desert Report Hub is an unofficial confirmation board and source radar. It keeps three input registers deliberately separate:

1. **Reports are evidence.** Structured anonymous player reports are the strongest input. Raw submissions stay private; only counts, neutral summaries, and moderator-approved excerpts may become public.
2. **Confirmations are signals.** One-tap *I have this too*, *Still happening*, and *Fixed for me* responses count what players say for an issue, platform, and patch family. They never become a verdict.
3. **Scanner links are leads.** Tavily-discovered public links keep the radar alive and generate questions players can answer. A link remains a lead, not evidence or authority chrome.

Official Pearl Abyss patch notes provide canonical patch context and fix claims, while the hub remains independent and unofficial.

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

- Show counts and evidence before opinion.
- Keep reports, confirmations, scanner leads, and official claims visibly distinct.
- Never infer “fixed” from quiet.
- Make privacy and network-hash limitations obvious.
- Keep admin review focused on real exceptions.
- Prefer dense, scannable operational UI over marketing pages.
- Stay useful at N=0.
- Keep Reddit API permanently off. Reddit pages may appear only through Tavily public-web discovery; promising thin results may receive bounded basic extraction after normalization to `old.reddit.com`.
- Keep Tavily at or below 1,000 monthly credits. Use `deepseek/deepseek-v4-flash` only for high-value scanner extraction and official fix-claim mapping, under a hard $2 UTC-month software cap and per-request price ceilings.
- Keep routine report moderation and dossier prose on `openrouter/free`, an explicit `:free` model, or deterministic fallback.
- Use a dedicated OpenRouter key with a provider-side monthly reset limit of $2 or lower, verified manually by a maintainer because the repository cannot inspect that dashboard setting.

## Non-Goals

- No official branding or implication of Pearl Abyss affiliation.
- No verdict machine or official-verifier claim.
- No public unreviewed complaint feed.
- No accounts, ads, or analytics trackers.
- No raw IP storage in the application database.
- No direct Reddit API integration.
- No open-ended scraping, paid search upgrade, unapproved paid LLM model, or surprise API spend.

## Success Criteria

- The dashboard, issues page, and source radar remain complete and informative with no visitors.
- A visitor can distinguish evidence, player signals, scanner leads, and official claims at a glance.
- The active patch label and official source link update without code changes.
- Players can report or confirm an issue without creating an account.
- Counts remain honest at one response. Confirmation-driven labels and meters escalate only when the driving tally reaches at least two distinct network hashes; a structured report is evidence immediately and does not need a second network.
- Admins can handle exceptions, change visibility immediately, and compile a dossier without becoming the daily lifecycle engine.
- Contributors can audit the privacy, cost, and source model publicly.
