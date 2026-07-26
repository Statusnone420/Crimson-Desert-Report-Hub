# Query bake-off

```bash
npm run scan:bakeoff
```

Runs the scanner's real query pack against the live Tavily API on the **development**
key, judges every result with the real pre-screen, and prints where each one would
land: kept as a signal, routed to a Brief observation lane, or dropped and why. A copy
lands in `output/bakeoff/` (gitignored).

## Why it exists

For three weeks the scanner asked two community domains and nothing else. Sixteen
trusted press and official domains sat on the approval list waiting for results to
wander in, and no test could see the difference — unit tests prove the code does what
it was told, never that what it was told is worth doing.

This closes that gap. Run it before changing a query, and again after.

## Setup

Put your **development** Tavily key in `.env.local`:

```
TAVILY_API_KEY=tvly-dev-...
```

The production key stays in the Vercel dashboard and never comes near this. `.env.local`
is gitignored, so it cannot be deployed. A later assignment overrides an earlier one, so
a blank placeholder above the real value is fine.

Cost is one Tavily credit per query — roughly a dozen per run, against the development
account's free monthly allowance.

## What it will not do

- write to any database
- read `process.env` for the key, so a production key cannot leak in from a shell
- run on CI or a deployment host (it exits early there)
- run under `npm run test`; the root vitest config includes only `tests/**`

It fails loudly rather than skipping. A tool that reports success while doing nothing is
the exact failure it exists to catch.

## Reading the output

`OBSERVATION:<kind>` is not a rejection. Patch notes and press coverage are not player
bug reports, so the pre-screen routes them to the Brief's context lanes instead of the
Issue Board. That routing is the design working.

Two things to weigh:

- **Non-community domains.** Publication needs two independent registrable domains, and
  Reddit can never be the second one. A run that surfaces only reddit.com and
  steamcommunity.com cannot corroborate anything, however many results it returns.
- **Dated results.** Only the news index returns real publication dates, and an
  observation without one is never displayed. The wire slot is the only source of them.

The news index is volatile — the same query returned 3 of 5 and 0 of 5 on-topic minutes
apart. Judge a query over several runs, never one.

## Keeping it honest

`PATCH_VERSION` and `PATCH_PUBLISHED_AT` at the top of `queries.bakeoff.ts` must be
updated together when a patch lands. A version-pinned query measured against a two-day-old
patch measures the calendar, not the query: the press has not written the articles yet.

The queries themselves are imported from `src/lib/automation/search.ts`, never restated
here, so this can never measure something the scanner has stopped running.
