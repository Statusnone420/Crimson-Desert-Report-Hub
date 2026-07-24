# Search + Share Presentation — Phase A proposal

**Status: approved 2026-07-24 (stacked v2); implemented on this branch.** The
production share images are byte-equal to `preview-1200x630.png` (enforced by
`tests/metadata.test.ts`); regenerate via `node docs/share-card/render.mjs`
and copy into `src/app/`.

## The card

One recommended direction: **the front page at arm's length.** The card is a
miniature Editorial Dispatch nameplate — the same Instrument Serif masthead the
site renders ("Crimson Desert" in cream, "Report Hub" in crimson, matching the
live `<em>` emphasis, which the July 6 card had inverted), the 3px crimson
topline, quiet IBM Plex Mono folio lines, hairline cream rules, the hex warrior
seal small like a printer's device, and substantial negative space on the warm
black canvas (`#110e0b`).

Composition, top to bottom:

1. 3px `--crimson-action` topline — the site's first pixel.
2. Folio row, mono, quiet: `INDEPENDENT PATCH INTELLIGENCE` left,
   `UNOFFICIAL · FAN-RUN` right — provenance and the honest identifier in the
   same slots the real masthead uses.
3. The masthead, stacked: `Crimson Desert` over `Report Hub`, 106px Instrument
   Serif 400 — sized so the whole wordmark sits inside the central 630px that
   a square thumbnail crop keeps.
4. The pledge, italic serif over two sentence-aligned lines: *What changed.
   What players are reporting. / What matters now.*
5. The warrior seal at 100px, flanked by short hairlines.
6. Quiet mono foot: `CRIMSONREPORTHUB.COM`.

No banner composition, no icon tile, no green dot, no CTA, no counts, no patch
numbers or dates — evergreen by construction.

**Why it survives as a thumbnail:** the stacked nameplate is enormous relative
to the frame and every line fits inside the central 630px, so BOTH crops hold
the entire wordmark. At ~116px (16:9) "Crimson Desert / Report Hub" is
literally readable; at a ~92px square center-crop the full two-tone wordmark
still reads, with the seal beneath it. Below word-legibility the card still
fingerprints: red hairline top edge, cream-over-crimson serif stack on warm
black, small red seal. Nothing else in a results page looks like that.

Sources: `share-card.html` (the mock, uses the real site tokens),
`render.mjs` (deterministic Playwright render), `preview-1200x630.png` (the
artifact), `preview-sizes.png` (full / ~514px social / ~116px + ~92px-crop
evidence).

## Exact proposed metadata

| Field | Proposed value |
| --- | --- |
| Search title (`title.default`) | `Crimson Desert Report Hub — Patch Issues & Player Reports` |
| Title template | `%s · Crimson Desert Report Hub` |
| Meta description | `An unofficial field report on Crimson Desert — what changed in the current patch, what players are reporting, and whether claimed fixes hold up.` |
| OG title | `Crimson Desert Report Hub` |
| OG description | `What changed. What players are reporting. What matters now. An unofficial, fan-run field report on the current state of the game.` |
| Twitter card | `summary_large_image`, mirroring the OG title/description |
| OG + Twitter image alt | `Crimson Desert Report Hub — cream and crimson serif masthead on warm black: "What changed. What players are reporting. What matters now." Unofficial, fan-run.` |

Rationale: the search title leads with the exact brand phrase people search and
declares the two things the site actually is (57 chars, safe from truncation).
The description is the reporting voice, not the dictionary voice, and stays
under ~150 chars. The OG title stays clean because the image itself carries the
pledge; the OG description repeats it for surfaces that show text without the
image.

## Phase B sketch (implements only after approval)

Smallest reliable approach, verified against the installed Next 16.2 source:
file-convention images are auto-attached only when the metadata object omits
`openGraph.images`/`twitter.images` (the object wins if it sets them — so we
provide the image as a file and never set `images` in the object), and nested
metadata objects merge shallow-replace (per-route overrides must re-spread
shared fields):

- Replace `src/app/opengraph-image.png` + `twitter-image.png` with a PNG
  rendered from the committed mock via `render.mjs` — static asset, evergreen,
  deterministic, zero crawler-time work, no DB fetch. Update both `.alt.txt`
  files. Render the production asset from the site's pinned self-hosted
  `next/font` binaries rather than the Google Fonts CDN, so the PNG matches
  the site exactly and regenerates offline.
- Update `src/lib/site.ts` description + `src/app/layout.tsx` title/OG/Twitter
  strings.
- Add homepage `WebSite` JSON-LD (native `<script type="application/ld+json">`,
  `<` escaped) with the proper site name.
- `src/app/sitemap.ts`: replace the hard-coded July 5 `lastModified` with the
  build-time date (the route is cached at build, so `new Date()` there is
  truthfully "as of this deployment"), add the missing public `/scanner`
  route, and revisit whether `changeFrequency: "hourly"` still reads honestly
  next to a build-time date.
- Route-level metadata: give `/issues`, `/report`, `/about`, `/scanner` real
  titles (revives the currently-dead title template) and per-route canonicals —
  today every route claims `canonical /`, which tells crawlers the subpages are
  duplicates of the homepage.
- Focused metadata tests; lint/typecheck/tests/build; inspect the built HTML
  head and image URLs locally; capture desktop/social/thumbnail evidence.
