# Design Notes

## Direction

The implemented public interface is an unofficial fan newspaper for Crimson Desert news, official patch records, player reports, and source context. It uses editorial scale, photography, columns, rules, and restrained color to make each kind of record clear without presenting the hub as Pearl Abyss or turning player activity into a verdict.

The authenticated surfaces use a related operator-console edition. They keep the same type families and rule-based structure, but use amber to distinguish private operations from the crimson public edition.

Every public surface remains complete at N=0. Empty and unavailable states state what is known, close unused sections where appropriate, and do not imply participation or a successful fix.

## Public Newspaper

- The page is a centered paper up to 1440px wide. A double top rule, dateline, theme control, large serif masthead, ruled navigation, and compact trust footer frame every public route.
- The front page leads with a large image-and-headline spread. It then moves through reviewed publication coverage, official patch claims, a separate player-report summary, game-context charts, and reviewed video coverage. Missing modules close ranks instead of leaving empty shells.
- News and article pages use centered editorial headings, wide hero imagery, source lists, readable serif story copy, related stories, and an optional sticky reading rail on wide screens.
- The Patch Desk separates official fix claims, the player record, and claim verdicts. The Issue Board separates published reports from watched scanner leads and keeps report counts, check-ins, public excerpts, source leads, and fix-poll results distinct.
- The Observatory presents Steam review movement, Twitch audience activity, and public-source radar as recorded context. Charts use labeled readouts and source notes; they do not style these aggregates as player evidence.
- The report flow is a compact editorial form with category choices, expandable optional details, an explicit review step, and a separate send action.
- Layouts collapse into single-column mobile compositions at their defined breakpoints. At 650px and below, the masthead wraps, the navigation omits its separate report link, editorial grids stack, and the footer supplies the report route. The front page is tested at 320px wide without document-level horizontal scrolling.

## Operator Surfaces

- Authenticated pages use a warm paper console with an amber top rule, compact nameplate, signed-in status, persistent theme control, destination navigation, and separate export/sign-out utilities.
- The overview prioritizes the current attention count, exceptions, service status, schedule, recent run record, and direct links to operator tools.
- Report review, scanner monitoring, visibility overrides, feedback rules, and dossier compilation use dense workbench layouts. Rules, columns, disclosure sections, ledgers, and limited tonal fills carry hierarchy.
- Status color is paired with text, counts, or state names. Green marks healthy or completed states, amber marks caution or partial states, and red marks failures, destructive actions, or attention.
- The private CSV export opens a disclosure that names its sensitive contents before download. Preview notices and disabled-write states stay visible in the console.

## Type, Color, and Surfaces

- Instrument Serif carries the masthead, headlines, article copy, and major numeric emphasis. Instrument Sans carries navigation, controls, labels, and supporting copy. IBM Plex Mono is reserved for machine facts in the older shared dispatch components and operational readouts that require tabular alignment.
- The public light palette uses paper `#f6f4ee`, ink `#11130f`, muted ink `#535550`, rule `#777971`, crimson `#a51e23`, blue `#2457a1`, and green `#346f60`.
- The public dark palette uses black `#000`, ink `#edeae3`, muted ink `#b8bbc0`, rule `#565a60`, crimson `#e15b62`, blue `#82aaf0`, and green `#98c2ac`.
- The operator edition uses the same paper, ink, muted, rule, red, and green values, plus amber `#946316` in light mode and `#dcad57` in dark mode.
- Dark mode is the server and first-visit default. The theme control switches the document between dark and light palettes and stores the choice locally.
- Crimson identifies the public edition, primary report actions, and issue emphasis. Blue identifies links and public charts. Green is reserved for positive recorded states; silence and zero counts remain neutral. Category colors identify data categories only and do not double as status colors.
- Rules and open space carry most hierarchy. Buttons and form fields use a modest 4px radius. Raised or tinted containment remains limited to decision, provenance, alert, and grouped-intelligence surfaces. The interface does not use a general card grid, decorative gradient, glass treatment, or decorative shadow system.

## Imagery and Icons

- The front-page and article heroes use official Pearl Abyss screenshots. Official content, combat, interface, graphics, localization, and other images also illustrate patch categories and issue groups.
- Game imagery is editorial or categorical illustration. It is not evidence that a specific issue or fix exists. Visible captions attribute Pearl Abyss, and the footer states that the site is unofficial, names the image copyright, and links to the source page.
- Locally stored SVG icons identify categories and the theme control. The warrior mark supplies the favicon and installed-app icons. The share card is a repository-owned 1200×630 newspaper render with matching alt text.
- Images use descriptive alt text when they carry content. Repeated decorative category imagery uses empty alt text where the surrounding heading already supplies the meaning.

## Interaction and Accessibility

- Pages use one main landmark, semantic headings, labeled navigation, field labels and legends, tables or definition lists for records, and `aria-current`, `aria-pressed`, and expanded-state attributes where applicable.
- A skip link reaches the main content. Long record pages add local skip links or section navigation. Keyboard focus uses a visible blue outline on the public edition and amber on the operator edition.
- Controls target at least 44px where practical, including navigation and coarse-pointer actions. Forms expose validation and submission failures as text and preserve reviewed report drafts after recoverable failures.
- Color always has a text, count, shape, or position cue. Public contrast checks require at least 4.5:1 for representative labels and footer links in the tested theme.
- Motion is brief and functional: navigation indication, reading progress, chart entry, image hover, and small directional cues. `prefers-reduced-motion` removes animation, transition, smooth scrolling, and hover zoom.
- Responsive verification covers 1440×1100 desktop, 390×844 mobile, and a focused 320px public-width check. The browser suite also checks landmarks, hidden focusable content, console/runtime health, image sizing, navigation state, and horizontal overflow.

The separate N=0 browser suite checks both empty fixture data and missing service configuration. It protects the distinction between a known zero and an unavailable count, and runs in CI after the regular browser suite.

## Evidence Boundaries

- Reports, player check-ins, scanner leads, official claims, reviewed articles, and platform aggregates keep distinct labels and visual regions.
- Raw counts remain visible. Confirmation-driven meters and stronger labels require at least two distinct network hashes in the driving tally. A structured report is evidence immediately.
- Scanner links are leads and questions. Reviewed editorial coverage is source-backed publication. Neither is styled as a player report.
- Official fix claims remain claims until the separate player record supplies responses. Quiet is never presented as proof of a fix.
