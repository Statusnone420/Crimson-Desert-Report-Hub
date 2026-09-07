# Visual decisions that need an owner

This concept is a working-desk proposal, not a locked visual system. Production still uses Instrument Serif / Instrument Sans / IBM Plex Mono via Next. This HTML uses a **system stack** so the file can open with no network. That gap is intentional and should be closed in implementation, not by loading Google Fonts in the concept.

## Needs a call

1. **Nav placement.** Compact single-row header: wordmark left, destinations as text buttons, theme/export/sign-out on the right. Alternative: keep today’s two-row nameplate (serif masthead + ruled nav). This concept prefers the single row so the first screen is the work, not a newspaper front.

2. **Typography scale.** Overview title is ~22px sans, not a 80px serif headline. Serif is reserved for the official fix quote and the small wordmark. If the operator edition must stay visually louder, raise the title — but do not return to article-length dek and 116px attention numerals.

3. **Attention numeral.** Do now uses a 36px serif count with a caption that names *what* is counted (reports + claim matches). Inventory (approved, spam) is labeled separately. Confirm whether Videos and AI-blocked belong in that numeral or only as extra Do-now rows (this concept: extra rows, not mixed into the Review count).

4. **Review split.** Desktop: ~268px queue + one detail column. Mobile: queue *then* item, not a stacked pair. Confirm the 880px breakpoint and whether Opening Review from Overview should land on the first item (this concept: yes from a Do-now jump; header Review on a phone lands on the queue).

5. **Claim quote treatment.** The invented official sentence is a left-ruled pull quote in serif. No Pearl Abyss screenshot in this concept (privacy + no external assets). Implementation may add the existing section illustration; it must not replace the exact sentence.

6. **Lock vs match.** Lock lives in a dashed disclosure under the match actions. If the owner wants lock completely off the claim desk (Scanner/break-glass only), say so before Slice B.

7. **Theme default.** Light is primary, matching the site. Dark is a first-class working palette (paper `#000`, amber `#dcad57`). Concept does not persist to `localStorage` so it cannot collide with the newspaper theme key.

8. **Wordmark.** Small serif “Crimson Desert *Report Hub*” with crimson italic, operator kicker in amber. Alternative: drop the public masthead entirely and say “Operator” only.

## Already assumed (reversible)

- No card grid, no glass, no decorative shadow.
- 4px radius on controls only.
- Amber focus rings on operator chrome.
- In-memory demo rail is not product chrome; do not ship it.
- System fonts in the concept; Instrument fonts in the app.
