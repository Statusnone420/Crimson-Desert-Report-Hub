# Design Notes

## Direction

The interface should feel like a restrained confirmation board and source radar: dark, dense, readable, and practical. It is not a fantasy fan site, a marketing landing page, a complaint wall, or a verdict machine.

Every public surface must also feel complete at N=0. Empty states describe what the instruments know; they never beg for participation or imply that a crowd already exists.

## Visual Style

- Dark neutral background with a restrained tonal ramp: canvas, inset (`--dispatch-inset`), and one raised tone (`--dispatch-raised`). The raised tier is reserved for decision surfaces, provenance, and grouped intelligence (flagged admin queue, the observatory footnote); it never wraps paragraphs into cards.
- Crimson as the primary action and issue-severity color.
- Amber for caution or claimed-fix states.
- Green on public issue readouts is reserved for players saying a fix worked for them. Silence is never green.
- Blue for links and informational states.
- Modest 4px radius on buttons and raised panels; nothing else is rounded.
- Rules and hairlines carry hierarchy by default; tonal containment is the exception.
- No glassmorphism, decorative gradients, official game assets, or oversized hero layout.
- Mono type carries machine facts and provenance (source, classification, publication state); it is not used as tiny low-contrast decoration.

## UI Principles

- Public pages should make reports, confirmations, and scanner leads easy to distinguish.
- Each issue card gets one composed readout label and one count-backed sentence. Do not stack confidence, evidence-ladder, and lifecycle badges into competing stories.
- Scanner links are framed as leads and questions, never evidence or authority.
- Raw counts remain visible; confirmation-driven meters and stronger labels require at least two distinct network hashes in the driving tally. A structured report is evidence immediately.
- Admin pages should prioritize queues, run history, and controls.
- Admin pages should prioritize exceptions and explicit lifecycle/visibility overrides rather than a dropdown farm.
- Status color must always be paired with text.
- Forms should be compact but clear.
- Text must stay readable on mobile and desktop.

## Current Reading Path

The public experience is an editorial instrument panel rather than a landing-page funnel:

1. **Patch Brief** establishes the current patch and the right-now context.
2. **At a glance** gives literal counts without turning them into a score.
3. **Scoreboard** separates official fix claims from player responses.
4. **Community pulse and source coverage** show what public observations add around the patch.
5. **Issue board and report actions** give the reader a clear next step without making participation a prerequisite for a useful page.

Badge art, screenshots, and decorative elements should support wayfinding. They should not delay the product explanation or compete with the evidence hierarchy.

## Accessibility

- Target WCAG AA contrast.
- Keep focus states visible.
- Use semantic headings and form labels.
- Avoid relying on color alone.
- Respect reduced-motion preferences.
