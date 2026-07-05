# Design

## Theme

Physical scene: a community moderator checks late-night patch reports on a second monitor while players are still filing fresh evidence. The UI should be dark, high-contrast, restrained, and operational.

## Color Strategy

Restrained product palette. Crimson is the primary action and issue-severity color because it is core to the product name and plan. A moss-green success role nods to the generated brand seed without overriding the crimson identity.

Use OKLCH custom properties in `src/app/globals.css`:

- `--bg`: near-black neutral application background.
- `--surface`: primary panel surface.
- `--surface-2`: lower-contrast nested surface.
- `--line`: borders and dividers.
- `--ink`: primary text, at least 7:1 on background.
- `--muted`: secondary text, at least 4.5:1 on panels.
- `--faint`: metadata and timestamps.
- `--crimson`: primary actions and high-risk issue status.
- `--amber`: pending, claimed fix, warning.
- `--moss`: verified fixed, success, healthy state.
- `--blue`: links and informational states.

## Typography

Use one practical sans stack: `Inter`, `Segoe UI`, `system-ui`, sans-serif. Use fixed rem sizes, not viewport-scaled typography. Headings are compact and direct; labels are short and sentence case unless a compact data label needs uppercase.

## Components

The shared component vocabulary is simple and consistent:

- Stat cards for headline counts.
- Panels for operational sections and forms.
- Badges for status and confidence.
- Meter bars and sparklines for aggregate comparison.
- Standard inputs, selects, textareas, and buttons with visible focus.
- Dense admin tables and row cards with inline actions.

Cards use modest radius only. No nested decorative cards, no soft shadow plus border pattern, no gradient text, no glassmorphism, no decorative hero.

## Layout

Top navigation is persistent and plain text. Public pages use responsive grids that collapse naturally. Admin pages prioritize queues, forms, and action density. Mobile layouts keep report submission and issue reading usable without horizontal scrolling.

## Motion

Transitions are limited to hover, focus, and small state changes, 150-200 ms. No page-load choreography. Respect `prefers-reduced-motion`.
