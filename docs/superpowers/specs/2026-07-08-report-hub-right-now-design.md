# Crimson Desert Report Hub: Right Now Design

## Purpose

Crimson Desert Report Hub is not a patch notes site and should not present itself as one. Pearl Abyss already owns official patch notes. The hub exists to answer a different question:

> What is happening around Crimson Desert right now, what looks worth checking, and what evidence or links can I trust?

The homepage should be useful even if nobody ever submits a player report. It should aggregate the current patch context, scanner findings, public chatter, report counts, useful official/community links, and open-source transparency into a clear situational readout.

## Product Frame

The product name remains **Crimson Desert Report Hub**.

The homepage concept is **Right Now**, not a renamed product. "Right Now" is the first-screen job: show the current situation quickly enough that the maintainer or a visitor from X can understand what is worth opening next.

Public pages should avoid internal-first labels as primary concepts:

- Avoid leading with "dashboard," "patch brief," "scanner funnel," "private leads," or "evidence board" as the main product promise.
- Use those concepts only where they clarify how the hub works.
- Prefer player-readable phrases: "Right now," "Worth checking," "Backed by reports," "Needs another source," "Official links," "Source radar," "How this hub works."

## HCI Goal

The interface must reduce cognitive load for a patch-day user.

- **User:** the maintainer first, then Crimson Desert players and technically minded visitors.
- **Task:** understand the current Crimson Desert situation and decide what to open, verify, or report.
- **Context:** patch day, noisy web chatter, thin evidence, official notes elsewhere, and a scanner collecting partial signals.
- **Interface requirement:** surface outcomes before mechanics. Scanner/process details support trust, but they do not own the first screen.

## Homepage Information Architecture

The first viewport should answer five questions in order.

1. **What is this?**
   - "Crimson Desert Report Hub tracks the current Crimson Desert situation: official context, web chatter, player reports, useful links, and what still needs verification."
   - Keep the existing brand and dark dense utility style.

2. **What is happening right now?**
   - A compact "Right now" readout with 3-5 plain-language observations.
   - Examples:
     - "Current patch: 1.13.01 hotfix. Official notes linked."
     - "Scanner checked 117 public candidates this week."
     - "7 items look plausible but need another source before publishing."
     - "1 player-backed issue is being tracked: FPS / performance regression."
     - "No public source links are strong enough yet for the current patch."

3. **What looks worth checking?**
   - A "Worth checking" list derived from existing issue clusters and scanner counts.
   - Each item should show:
     - Title
     - Short reason it is being watched
     - Strength label: `Player reported`, `Public source`, `Needs another source`, or `Watching`
     - Count summary without overstating proof
     - CTA: "I am seeing this" or "View evidence"

4. **Where are the useful links?**
   - A compact link block:
     - Official patch notes
     - Pearl Abyss support
     - Known issues / evidence ledger
     - Source radar
     - Open-source code
   - These links are part of the hub's value, not secondary footer material.

5. **Can I trust this?**
   - A short trust strip:
     - No accounts, ads, or trackers
     - Raw submissions stay private
     - Scanner candidates stay private until corroborated
     - Official notes are context, not player evidence

## Page Roles

### `/`

Role: current situation hub.

Primary content:
- Brand and one-sentence purpose
- Right Now readout
- Worth Checking list
- Useful Links block
- Small evidence/trust explanation
- Compact scanner heartbeat

Secondary content:
- Short "backed by reports" summary
- Official context card lower on the page
- Link to detailed source radar

The homepage should not lead with large internal metric cards. Scanner metrics can appear, but only as supporting evidence for the readout.

### `/issues`

Role: stricter evidence ledger.

This page should show what is backed, what is only suspected, and what still needs another report or public source. It can keep the evidence-board discipline, but the language should be clearer:

- "Known issues" or "Issue ledger" in navigation
- "Backed by reports" for real player/public evidence
- "Needs another source" for candidate-only topics
- "Watching" for seeded clusters with no current signal

Avoid presenting one report as strong proof. One report is useful, but it should read as early evidence.

### `/scanner`

Role: source radar / operator view.

This can stay dense and operational. It is useful to the maintainer and transparent to visitors who want to audit the pipeline. It should not be framed as the main product surface.

The scanner page may show private candidate summaries to the maintainer, but public-facing copy must preserve the rule: private candidate text and rejected URLs do not leak onto public pages.

### `/report`

Role: add your case to the hub.

Change the tone from "submit to an evidence board" to "add your case to the current situation." The report form should make clear why one structured report matters even if nobody else submits:

- Platform
- Patch version
- Severity/frequency
- Hardware
- Repro steps
- Optional official PERS ID or external link

The local save/config-file helper remains valuable because it turns a personal report into technically useful data.

### `/about`

Role: how the hub works.

Reframe around:

- Unofficial, fan-run hub
- Aggregates official context, public web chatter, player reports, and open-source process
- Keeps raw reports/private candidates private
- Does not replace Pearl Abyss support
- Helps the maintainer and visitors understand the current game situation

## Data Presentation Rules

- Official patch notes are canonical context, not proof.
- Patch-family evidence can carry forward for continuity, but post-hotfix persistence must require post-hotfix evidence.
- Private scanner candidates can influence aggregate counts and "worth checking" prompts, but public pages must not expose private candidate text, raw URLs, or reject reasons.
- "No public findings" must not read like "nothing is happening." It should explain that the scanner is holding leads until corroborated.
- One direct report should be labeled as early evidence, not consensus.
- "Fix claimed" and "Player reported" can appear together only with copy that explains whether the player evidence is before or after the hotfix.

## Visual Direction

Keep the existing restrained dark product UI:

- Dense, practical, second-monitor utility feel
- Existing dark neutral surfaces
- Crimson for primary actions and issue severity
- Amber for caution / needs confirmation
- Green for healthy/active
- Blue for links/info
- Modest panel radii and compact controls

Avoid:

- A marketing hero
- A patch-notes hero
- Oversized decorative stats
- Nested card-heavy clutter in the first viewport
- Internal process labels as the main content hierarchy

## First-Screen Layout

Recommended desktop structure:

```text
Crimson Desert Report Hub                         [Current patch] [Report a bug]
Tracks the current Crimson Desert situation: official context, web chatter,
player reports, useful links, and what still needs verification.

RIGHT NOW
┌──────────────────────────────────────────────┬───────────────────────────┐
│ Current situation                            │ Useful links              │
│ - Current patch + official note link          │ Official notes            │
│ - Scanner/source activity summary             │ Pearl Abyss support       │
│ - Player/report evidence summary              │ Known issues              │
│ - What is thin / needs verification           │ Source radar              │
│                                               │ Open source               │
└──────────────────────────────────────────────┴───────────────────────────┘

WORTH CHECKING
FPS / performance regression        Player reported · early evidence
Crashes and startup hangs            Needs another source
Mount/input/title-screen lockups     Needs another source
```

On mobile, this should collapse into:

1. Brand/purpose
2. Right Now observations
3. Useful links
4. Worth Checking cards
5. Trust strip

## Success Criteria

The pass is successful when:

- The homepage no longer reads as a patch notes site, patch brief, generic dashboard, or scanner console.
- A visitor can answer "what should I check next?" without scrolling past scanner mechanics.
- The maintainer can use the homepage even with zero public reports.
- Thin data is presented honestly but still usefully.
- The Issues page remains stricter than the homepage.
- The Scanner page remains available for transparency and operations.
- The Report page explains why a single structured case matters.
- Public pages do not leak private scanner candidate text or rejected URLs.
- Desktop and mobile screenshots show a clear first-screen purpose.

## Testing And Verification

Implementation should include:

- Unit tests for any new presentation transformer that converts dashboard/scanner data into Right Now observations.
- Existing privacy tests proving private candidates remain private.
- E2E assertions that the homepage contains:
  - "Crimson Desert Report Hub"
  - "Right now"
  - "Worth checking"
  - Official notes link
  - Source radar link
  - Report CTA
- Screenshot validation for homepage, issues, report, about, and scanner on desktop.
- Mobile screenshot validation for homepage and issues.
- `npm run lint`
- `npm test`
- `npm exec tsc -- --noEmit`
- `npm run build`

## Implementation Boundary

This spec does not require new database tables. It should primarily reshape existing dashboard, scanner, issues, and report data into a clearer public interface.

New data helpers are allowed only if they reduce UI complexity or protect privacy rules. New dependencies are not expected.
