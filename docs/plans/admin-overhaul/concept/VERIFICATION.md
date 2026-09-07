# Verification (Slice A concept)

Checks below were run against `index.html` on this branch. They are not app, CI, or production checks. Sample copy is invented.

## Method

- Browser: Chromium via Playwright 1.61.1 driving `/usr/local/bin/google-chrome`, `file://` URL, headless, `--no-sandbox`.
- Script: `capture-screenshots.cjs` (optional regenerator; not required to view the concept).
- Viewport screenshots (not full-page): **1440×1100** and **390×844**.
- No Next server, no network from the page, no production admin session, no real reports.

## Screenshots captured

All under `screenshots/`. Themes: light and dark. Required key states:

| State | Desktop 1440×1100 | Mobile 390×844 |
| --- | --- | --- |
| Overview · normal | `desktop-{light,dark}-overview-normal.png` | `mobile-{light,dark}-overview-normal.png` |
| Review · claim match | `desktop-{light,dark}-review-claim.png` | `mobile-{light,dark}-review-claim.png` |
| Overview · empty | `desktop-{light,dark}-overview-empty.png` | `mobile-{light,dark}-overview-empty.png` |
| Review · failed-save | `desktop-{light,dark}-review-failed-save.png` | `mobile-{light,dark}-review-failed-save.png` |

Extra (light only, not a complete theme matrix):

- `desktop-light-overview-unavailable.png` — count is unavailable, not a green zero
- `desktop-light-overview-ai-blocked.png` — AI row in Do now; mapping blocked copy
- `mobile-light-review-queue.png` — mobile queue before opening an item

## Layout

| Check | Result |
| --- | --- |
| 320×844 Overview normal (light) | `documentElement.scrollWidth === clientWidth` (320). No overflowing descendants in the sampled set. |
| 320×844 Review claim, detail pane | Same: delta 0. |
| 320×844 Review queue pane | Same: delta 0. |
| 720×1100 (stand-in for 200% of a 1440-wide window) Overview and Review | delta 0 on both. |
| Chromium `document.documentElement.style.zoom = 2` at 1440×1100 | Layout `clientWidth` stayed 1440; delta 0. This is **not** the same as the browser’s View → Zoom 200% control. |

## Keyboard

Automated Tab on Overview (light, 1440): skip link → wordmark → Overview/Review/Videos/Scanner/Dossiers → theme → Export → Sign out → concept chips (Light, Dark, Overview, Review, Normal, Empty, AI-blocked, Unavailable). The 18th Tab had not yet reached Failed-save or Do-now jumps.

- Skip link: focusing `.skip-link` moved it to `top: 8px`.
- Review queue: focusing the first `.q-item` and pressing Enter kept `#item-title` as “Horse stride snaps at canter-to-gallop”.
- Confirm control: Tab/focus reached `[data-decide="confirm"]`.

Not automated: full Tab through the claim form, reverse Tab, screen reader, Escape-to-close export, mobile Escape-to-queue. Those behaviors exist in `concept.js` and were not separately timed in this run.

## Reduced motion

A second Playwright page with `reducedMotion: "reduce"`: `matchMedia('(prefers-reduced-motion: reduce)')` was true. A `.chip` computed `transition-duration: 0s` and `animation-name: none`. No motion screenshot was recorded.

## In-memory demo behavior (scripted)

- Failed-save: excerpt field started with the invented sentence; the error banner was present; typing appended ` (typed after error)` in the same field; Approve then showed a demo toast and advanced the queue (retry path).
- Confirm on the claim: queue text still contained “Horse stride” and a decided/kept marker.

## Gaps and tool limits

- Firefox, Safari, and a physical phone were not used.
- Contrast was not measured with a meter; light-mode ink on paper was judged from the PNGs only.
- System fonts, not Instrument Serif/Sans.
- Sticky mobile actions can sit over the last fact row until the operator scrolls; Confirm stayed inside the 390×844 viewport in the claim PNG.
- Concept rail is extra chrome and steals vertical space the product header would not.
- `file://` plus Chrome sandbox flags are an environment detail, not a product requirement.
- No production screenshots or private exports are in this folder.

## Not run (out of scope)

`npm run lint`, unit tests, `tsc`, production build, e2e against the Next app, scanner bake-off, migrations, paid provider calls.
