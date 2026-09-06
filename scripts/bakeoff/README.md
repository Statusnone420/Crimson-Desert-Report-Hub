# Query bake-off

```bash
npm run scan:bakeoff
```

Runs the scanner's real queries against the live Tavily API on the **development** key,
judges every result with the real pre-screen **and the real observation gate**, and
prints its modeled classification: signal, eligible observation, stored-only
observation, or rejection. A timestamped copy lands in `output/bakeoff/`
(gitignored), so a "before" run survives to compare against.

The output retains the older label `render in the Brief` and the predicate
`isBriefEligibleObservation`. These measure observation eligibility, not current
newspaper publication. Observations now appear in the authenticated scanner archive;
front-page articles and external selections use the separate editorial registers.

Three lanes are measured, because they ask different questions and build different
query strings:

| lane | built by | what it has to do |
| --- | --- | --- |
| `discovery` | `buildSearchQueries` | find player complaints about the current patch |
| `wire` | `buildWireNewsQuery` | use the news index for source publication dates |
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

Keep the production key out of this file. `.env.local` is ignored by Git; that is not
permission to include it in deployment artifacts or logs. The parser uses the last
non-empty assignment, so a blank placeholder above the development value is fine.

The run refuses to start unless the key begins with `tvly-dev-`. That is a hard stop,
not a warning, and the key is never printed.

Cost is one Tavily credit per query. The command prints the current plan size before it
runs; charge that count against the development account's provider allowance.

## What it will not do

- write to any database
- read `process.env` for the key, so a production key cannot leak in from a shell
- run on CI or a deployment host (it exits early there)
- run under `npm run test`; the root vitest config includes only `tests/**`

It fails loudly rather than skipping. A tool that reports success while doing nothing is
the exact failure it exists to catch.

## Reading the output

Each query models its own production run, because at the default search depth a
scheduled run issues exactly one pack query. Urls are deduped within a query
(`repeat urls skipped`), while a page returned by two queries is judged both times
and counted as a `cross-query repeat` — production's separate runs re-judge and
reobserve such a page, so suppressing it would understate a query's yield. The
report's `dedupe:` header line states these rules; never compare two reports whose
headers differ.

The wire query is the one run production never issues alone — the wire slot needs a
budget of two, and the run's other results land ahead of it in first-wins order — so
its report line states how many wire results discovery also returned: the upper bound
on what a shared run could dedupe against discovery, since which query shares the
wire's run rotates through the whole pack.

`OBSERVATION:<kind>` is not a rejection. The pre-screen routes patch notes and press
coverage to scanner observations instead of treating them as player bug reports.

There are three observation outcomes. None publishes an article:

| outcome | meaning |
| --- | --- |
| `OBSERVATION:<kind>` | accepted by both the collection and retained display-eligibility gates |
| `OBSERVATION_STORED:<kind>` | collected, but fails the display-eligibility gate, for example when undated |
| `OBSERVATION_REJECTED:<kind>` | thrown away at `shouldCollectObservation`, almost always an untrusted registrable domain |

Both of the lower two were added after the harness reported outcomes production
discards. A query whose results are all `OBSERVATION_REJECTED` is spending a credit for
nothing. `OBSERVATION_STORED` counts must not be presented as public coverage.

Expect `render in the Brief` to be **0** on a general-search run, and do not read that
as a bug in the pack. `isBriefEligibleObservation` requires a real
`source_published_at`; the wire lane uses Tavily's news index to obtain source dates.
This output is a predicate result, not a check of the deployed page.

Two more things to weigh:

- **Non-community domains.** Publication needs two independent registrable domains, and
  Reddit can never be the second one. A run that surfaces only reddit.com and
  steamcommunity.com cannot corroborate anything, however many results it returns.
- **Dated results.** The wire slot queries the news index for publication dates.
  Undated results do not pass the retained display-eligibility gate.

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
The command does not verify those constants against Supabase or production. Check them
before spending credits or quoting a report.

The queries themselves are imported from `src/lib/automation/search.ts`, never restated
here, so this can never measure something the scanner has stopped running.
