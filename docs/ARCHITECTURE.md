# Architecture

This is the public architecture contract: enough structure to review the privacy and evidence boundaries, without turning the documentation into a recipe for the project's discovery, ranking, or moderation strategy.

## The public surfaces

| Route | Public purpose |
| --- | --- |
| `/` | Newspaper front page: the newest patch story, official record, selected external coverage, patch context, then a "Before you play" band of recorded Steam and patch readings above the aggregate platform pulse. Manual reporting wins for the same exact version. Before the expansion's release, one countdown line from the newest official notice's release time sits above the lead story. For the seven days after release, the readings lead the page as a launch watch: Steam players against the usual, today's Steam reviews, the newest patch, and the scanner's thread counts. |
| `/news` | Original Hub reports and automatic official-note rundowns, plus selected external coverage. |
| `/articles/*` | Source-backed editorial reports and templated official patch rundowns. |
| `/topics/charting-the-unknown` | Expansion desk built from the official notices on the catch-up timeline: the release time and countdown, each notice's own lines, the official videos, the Steam store price with its source, and what no notice has said yet. Videos with a local still play in place from `youtube-nocookie.com`, the one video frame source the CSP allows, and only after a reader clicks play. |
| `/watch` | Official video and selected creator coverage, with links to the original channels. |
| `/patches` | Current official patch record, stated fix claims, player responses, and an archive of retained official versions. |
| `/patches/[version]` | Permanent historical claim record; does not reuse current player verdicts. `/patches/archive` redirects to `/patches#archive`. |
| `/issues` | Issue board with evidence counts, reviewed links, answers to official fixes, optional thumbs that only the tapper sees, and patch-scoped readouts. An empty board shows only the scanner's thread and topic counts for the patch. |
| `/observatory` | Aggregate Steam, Twitch, IGDB, and source-radar context with collection-health labels: the week before and after each official update with a one-sentence summary of the newest, a day-by-day chart of new Steam reviews, Twitch viewers and Steam players (one at a time, with updates marked and today's partial day kept out of averages), and each day's Steam reviews against the usual positive share of the recorded full days. |
| `/report` | Permanent redirect to `/issues`, preserving valid issue references. `POST /api/reports` returns 410 without reading a payload or writing data. |
| `/scanner` | Permanent redirect to `/observatory`. Signed-in diagnostics and review actions live at `/operator?view=scanner`; model, budget, schedule, and search settings live at `/operator?view=ai`. |
| `/admin/videos` | Authenticated owner inbox for manually reviewing YouTube links. Approval stores a private draft only. |
| `/about` | Method, privacy posture, and official-support guidance. |
| `/contact` | Explains where corrections and website problems go: the private **Report a problem** button (no account needed), plus separate game-support and check-in links. |
| `/privacy` | Short public privacy note; the full policy remains in the repository. |
| `/feed.xml` and `/rss.xml` | Atom and RSS 2.0 feeds for original Hub articles and automatic official patch rundowns. |

The public pages are designed to remain useful when there are no reports, taps, or published leads. Empty states describe the limits of the current evidence instead of filling the space with inferred conclusions.

### Public desk date

Every `NewspaperShell` page uses `DeskDate` in the shared header. The display-only
date follows `America/New_York`, matching the desk's Eastern Time day; stored
timestamps and source publication dates keep their existing UTC conventions.
The browser supplies the current date after hydration, checks at each minute
boundary, and refreshes on focus, visibility changes, and page restoration.
Cached HTML contains only `Eastern Time`, so independently cached routes cannot
reintroduce an old calendar day. Without JavaScript that label remains visible;
with JavaScript the date depends on the reader's device clock. No request or
analytics code is involved.

## Separate public registers

The hub does not collapse every input into one score:

1. **Official context** supplies the current patch and the publisher's stated fix claims.
2. **Historical player reports** are retained structured accounts; only approved excerpts may be public. New written-report intake is retired.
3. **Player responses** are anonymous, patch- and platform-scoped answers to an official fix: *Still happening* or *Fixed for me*. A thumb up or down is separate: only the device that tapped it shows it, and it never decides what is published.
4. **Source-radar links** are public leads that help form questions; a link is never evidence merely because the scanner found it.

Patch observations remain in the authenticated scanner context archive for diagnostics and moderation. They no longer supply front-page articles. Their identity remains scoped to both URL and patch so an older patch's record cannot silently move into a newer patch.

The newspaper has two further editorial registers. **Original reports** are first-party articles written by the Report Hub and keep their source links with the story. **Selected coverage** is a manually reviewed list of official, press, or creator links. Its source, URL, publication date, headline, and excerpt must pass the editorial publication checks before display. It remains outbound coverage, not a Report Hub article, player evidence, or scanner promotion.

**Official-note rundowns** use a fixed template and stored official fix excerpts for every retained version. They join manual articles in the shared homepage, News, Catch Up, Atom, RSS, and sitemap publication list. No per-rundown model call or separate publication write is added.

The Atom and RSS feeds exclude selected external coverage, Watch videos, scanner leads, issues, and Observatory data.

**Private problem reports** come from the site-wide **Report a problem** button. They go to an authenticated owner inbox and never enter public queries, feeds, exports, scanner prompts, or issue counts.

## Boundary model

```text
public visitor or authenticated maintainer
                 |
                 v
          Next.js server boundary
       validation, auth, patch context
                 |
                 v
        Supabase service-role boundary
      public aggregates / private records
                 |
                 +--> reports, confirmations, source leads
                 +--> patch context and diagnostic observations
                 +--> Steam, Twitch, and IGDB snapshots
                 +--> automation history and settings
                 +--> private video-review candidates and drafts
                 +--> private problem reports (owner inbox only)

       maintained original articles -----------+
                                               |
       retained official notes + fix excerpts  |
                 |                             |
                 +--> automatic rundowns ------+
                                               |
                                               v
                          shared article, feed, and sitemap publication list

       reviewed outbound coverage --> newspaper pages only
```

The browser never receives the Supabase service-role key. Public queries return server-authored aggregates and reviewed rows; raw reports, rejected candidates, network hashes, individual confirmation rows, credentials, and private moderation details remain outside the public read model.

## Automation in one paragraph

A protected deployment trigger wakes the application on its schedule. The application checks its persisted scanner policy and recent run history, respects pause/interval/budget boundaries, gathers public web and optional platform context through the approved provider lanes, and only then updates private review queues, aggregate snapshots, public leads that satisfy the publishing rules, or diagnostic observations. A protected no-write preview shows the query plan; it makes no provider calls and cannot demonstrate the live scanner funnel.

Manual editorial publishing remains a separate maintained path. Issue candidates cannot enter the original-article or selected-coverage registers automatically. Successful official-note ingestion refreshes the shared patch publication cache so retained versions become public rundowns.

The exact search packs, prompt text, scoring weights, source filters, extraction strategy, and exception thresholds are implementation details. They are deliberately not part of this public contract because they change as the project learns.

## Provider and privacy commitments

- Supabase is the application database and migration authority.
- Tavily is used for bounded public-web discovery; the deployment stays within its documented monthly ceiling.
- The approved OpenRouter lanes are budget-capped, with free or deterministic fallback for routine work.
- Optional Steam collection stores aggregate review and connected-player snapshots. Review text used during classification and hashed provider identifiers stay in private scanner records. Connected-player counts exclude offline play and other platforms and are context, not player evidence.
- Optional Twitch and IGDB collection stores aggregate live-audience status and public game metadata. These provider snapshots are context, not reports, confirmations, or proof of an issue.
- Steam's keyless news API supplies the publisher's own patch announcements to the official patch record when they name a version the Pearl Abyss notice board has not posted yet. They are official context, not an independent source.
- Newspaper coverage comes from a separate reviewed source list. Only approved hosts and verified creator videos can appear; discovery results cannot publish themselves there.
- Reddit API access is permanently off. Public Reddit pages can only arrive through ordinary public-web discovery.
- Cloudflare Turnstile is required for public check-ins and private problem reports. Each verified token can save once. The written-report form and API are retired.
- No player accounts, ads, or analytics trackers are part of the public product. A private problem report may include an optional email address, which only the owner inbox shows.
- Raw IP addresses are not stored; salted one-way network hashes are used only for abuse controls and deduplication.

## Contribution and release boundaries

Contributors can review the UI, schemas, tests, privacy behavior, and public aggregation rules from the repository. A migration file can be reviewed without being applied. Applying a migration or changing a hosted provider remains an owner-authorized release action.

Use the [Contributing guide](../CONTRIBUTING.md) for local checks. The public docs do not replace private credentials, dashboard access, or owner decisions.
