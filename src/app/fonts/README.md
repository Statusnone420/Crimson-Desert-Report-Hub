# Application fonts

These WOFF2 files preserve the exact binaries from the application's existing
Google Fonts output. `src/app/layout.tsx` loads them with `next/font/local`, so
a fresh development or production build does not download fonts from Google.

| Family | Faces and character subsets | License |
| --- | --- | --- |
| Instrument Sans | Normal, variable weight 400–700; Latin and Latin extended | [SIL OFL 1.1](instrumentsans-OFL.txt) |
| Instrument Serif | Normal and italic, weight 400; Latin and Latin extended | [SIL OFL 1.1](instrumentserif-OFL.txt) |
| IBM Plex Mono | Normal, weights 400 and 500; Latin, Latin extended, Cyrillic, Cyrillic extended, and Vietnamese | [SIL OFL 1.1](ibmplexmono-OFL.txt) |

The font bytes, weight ranges, styles, and CSS variables stay the same. Each
face lists Latin last so it has precedence when character maps overlap. The
other files retain the existing extended character coverage. Next.js preloads
the bundled local files; all 16 files total 153,508 bytes.

The upstream projects are [Instrument Sans](https://github.com/Instrument/instrument-sans),
[Instrument Serif](https://github.com/Instrument/instrument-serif), and
[IBM Plex](https://github.com/IBM/plex). The full license notices are copied from
the [Google Fonts repository at 9710da1](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl).

Run `npm run verify` after changing fonts. Keep the existing screenshot
baselines and tolerances when changing only the loader.
