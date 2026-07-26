# Query bake-off

```bash
npm run scan:bakeoff
```

Runs the scanner's real queries against the live Tavily API on the **development** key,
judges every result with the real pre-screen **and the real observation gate**, and
prints where each one would land: kept as a signal, reaching the Brief, routed but
discarded, or dropped and why. A timestamped copy lands in `output/bakeoff/`
(gitignored), so a "before" run survives to compare against.

Three lanes are measured, because they ask different questions and build different
query strings:

| lane | built by | what it has to do |
| --- | --- | --- |
| `discovery` | `buildSearchQueries` | find player complaints about the current patch |
| `wire` | `buildWireNewsQuery` | the only lane that returns publication dates |
| `corroborate` | `buildMemorySearchQueries` | reach a SECOND registrable domain for a known cluster |

The corroborate lane fires one probe per site rotation using a representative cluster
title. What that probe measures is whether the site scope survives once a title is
appended and whether the results stay on topic — not the title's own yield.

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

The run refuses to start unless the key begins with `tvly-dev-`. That is a hard stop,
not a warning, and the key is never printed.

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

There are three observation outcomes, and only the first one reaches a reader:

| outcome | meaning |
| --- | --- |
| `OBSERVATION:<kind>` | collected **and** displayable — this renders |
| `OBSERVATION_STORED:<kind>` | collected, but the Brief needs a publication date and this has none |
| `OBSERVATION_REJECTED:<kind>` | thrown away at `shouldCollectObservation`, almost always an untrusted registrable domain |

Both of the lower two were added after the harness reported outcomes production
discards. A query whose results are all `OBSERVATION_REJECTED` is spending a credit for
nothing. A query whose results are all `OBSERVATION_STORED` is filling a table nobody
sees.

Expect `render in the Brief` to be **0** on a general-search run, and do not read that
as a bug in the pack. `isBriefEligibleObservation` requires a real
`source_published_at`, and only Tavily's news index returns one. That single gate is
what keeps the Brief's observation sections dark in production while the table has rows
in it.

Two more things to weigh:

- **Non-community domains.** Publication needs two independent registrable domains, and
  Reddit can never be the second one. A run that surfaces only reddit.com and
  steamcommunity.com cannot corroborate anything, however many results it returns.
- **Dated results.** Only the news index returns real publication dates, and an
  observation without one is never displayed. The wire slot is the only source of them.

**Everything here is volatile.** Not just the news index. The
`site:pcgamer.com OR site:eurogamer.net OR site:dsogaming.com` trio returned three real
Crimson Desert articles in one run and five dictionary definitions of the word "OR" four
minutes later; the official subdomain slot returned nothing in one run and the Known
Issues notice in the next. A `site:` group holds only while some member has matching
content, and when none does Tavily drops the filter rather than returning nothing.

So: judge a query over several runs, never one, and treat a small delta between two runs
as noise. Only a change that shows up repeatedly is a finding.

## Keeping it honest

`PATCH_VERSION` and `PATCH_PUBLISHED_AT` at the top of `queries.bakeoff.ts` must be
updated together when a patch lands. A version-pinned query measured against a two-day-old
patch measures the calendar, not the query: the press has not written the articles yet.

The queries themselves are imported from `src/lib/automation/search.ts`, never restated
here, so this can never measure something the scanner has stopped running.
