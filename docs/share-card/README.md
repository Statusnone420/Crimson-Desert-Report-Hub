# Newspaper share images

The current cards use the public newspaper's paper `#f6f4ee`, ink `#11130f`, crimson `#a51e23`, Instrument Serif masthead, Instrument Sans labels, ruled sections and attributed Pearl Abyss imagery. Both X and Open Graph use 1200×630 PNGs.

Run from the repository root:

```sh
node docs/share-card/render.mjs
```

This renders the two HTML compositions, updates the size evidence sheet, and copies the output to the served assets:

| Source | Output |
| --- | --- |
| `share-card.html` | `src/app/opengraph-image.png` and `src/app/twitter-image.png` |
| `patch-2-02-00.html` | `public/share/patch-2-02-00.png` |

The root images use Next.js file metadata, including a content hash in the URL. Route metadata must retain the resolved parent images. The fixed article card has an absolute URL in both metadata blocks; its version is the subject of the article, never the current-patch source of truth.

Fonts are vendored for offline rendering; see [font licenses](fonts/LICENSE.md). Photography comes from `public/official/coast.jpg` and the unmodified `public/official/patch-2-02-00.png`. Their original URLs, copyright and checksums are recorded in [the official asset manifest](../../public/official/sources.json). These cards are HTML/CSS renders of those local assets, not gameplay evidence.

## Verification and delivery

Metadata tests check pixel dimensions, file-size limits, alt text and identical root image bytes. The browser suite requests `/`, `/news`, `/patches` and the article as X and messaging crawlers; it checks server-rendered tags, absolute image URLs, GET/HEAD responses and actual PNG dimensions. Next.js deliberately emits localhost URLs for file metadata in development, so also check a production build for the canonical HTTPS origin.

On September 11, the original X post's public metadata already linked to a working X-hosted copy of the previous card. The reported grey placeholder could not be reproduced at the image-delivery layer. This change updates the visual identity and route titles; it does not claim to repair X's internal client or cache. Existing posts may retain older artwork until X fetches them again. Native iMessage rendering still needs a post-release check on an iPhone; the Open Graph contract and image format are preserved here.
