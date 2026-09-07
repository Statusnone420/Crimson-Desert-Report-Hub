# Architecture

This is the public architecture contract: enough structure to review the privacy and evidence boundaries, without turning the documentation into a recipe for the project's discovery, ranking, or moderation strategy.

## The public surfaces

| Route | Public purpose |
| --- | --- |
| `/` | Newspaper front page: the current original report, official record, selected external coverage, patch context, and aggregate platform pulse. |
| `/news` | Index of original reports published by the Report Hub, plus selected external coverage. |
| `/articles/*` | First-party, source-backed editorial reports. The legacy `/topics/charting-the-unknown` route redirects to its canonical article. |
| `/watch` | Official video and selected creator coverage, with links to the original channels. |
| `/patches` | Current official patch record and the publisher's stated fix claims. |
| `/issues` | Issue board with evidence counts, reviewed links, player responses, and patch-scoped readouts. |
| `/observatory` | Aggregate Steam, Twitch, IGDB, and source-radar context with collection-health labels. |
| `/report` | Anonymous structured report intake. |
| `/scanner` | The Observatory view for anonymous visitors and the scanner monitor for an authenticated admin. This compatibility route is excluded from search indexing. |
| `/admin/videos` | Authenticated owner inbox for manually reviewing YouTube links. Approval stores a private later-PR draft only. |
| `/about` | Method, privacy posture, and official-support guidance. |
| `/privacy` | Short public privacy note; the full policy remains in the repository. |
| `/feed.xml` and `/rss.xml` | Separate Atom and RSS 2.0 feeds for original Report Hub articles only. |

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

After deployment, compare `/`, `/issues`, and `/report` in a browser against the
current New York date. Check both direct loads and navigation, then repeat after
New York midnight with an existing tab and after returning to a suspended tab.
Raw HTML alone is not a date-freshness check because its placeholder is intentional.

## Separate public registers

The hub does not collapse every input into one score:

1. **Official context** supplies the current patch and the publisher's stated fix claims.
2. **Player reports** are structured accounts that are reviewed before any excerpt can be public.
3. **Player responses** are anonymous, patch- and platform-scoped signals such as *Still happening* or *Fixed for me*.
4. **Source-radar links** are public leads that help form questions; a link is never evidence merely because the scanner found it.

Patch observations remain in the authenticated scanner context archive for diagnostics and moderation. They no longer supply front-page articles. Their identity remains scoped to both URL and patch so an older patch's record cannot silently move into a newer patch.

The newspaper has two further editorial registers. **Original reports** are first-party articles written by the Report Hub and keep their source links with the story. **Selected coverage** is a manually reviewed list of official, press, or creator links. Its source, URL, publication date, headline, and excerpt must pass the editorial publication checks before display. It remains outbound coverage, not a Report Hub article, player evidence, or scanner promotion.

The Atom and RSS feeds contain original reports only. They exclude selected external coverage, Watch videos, scanner leads, issues, and Observatory data.

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
                 +--> private video-review candidates and later-PR drafts

       maintained editorial register
      original articles / reviewed outbound links
                 |
                 +--> newspaper pages and original-article feeds
```

The browser never receives the Supabase service-role key. Public queries return server-authored aggregates and reviewed rows; raw reports, rejected candidates, network hashes, individual confirmation rows, credentials, and private moderation details remain outside the public read model.

## Automation in one paragraph

A protected deployment trigger wakes the application on its schedule. The application checks its persisted scanner policy and recent run history, respects pause/interval/budget boundaries, gathers public web and optional platform context through the approved provider lanes, and only then updates private review queues, aggregate snapshots, public leads that satisfy the publishing rules, or diagnostic observations. A protected no-write preview exists for maintainers to inspect the scanner funnel without changing public data.

Editorial publishing is a separate maintained path. Scanner output cannot enter the original-article or selected-coverage registers automatically.

The exact search packs, prompt text, scoring weights, source filters, extraction strategy, and exception thresholds are implementation details. They are deliberately not part of this public contract because they change as the project learns.

## Provider and privacy commitments

- Supabase is the application database and migration authority.
- Tavily is used for bounded public-web discovery; the deployment stays within its documented monthly ceiling.
- The approved OpenRouter lanes are budget-capped, with free or deterministic fallback for routine work.
- Optional Steam collection stores aggregate review and connected-player snapshots. Review text used during classification and hashed provider identifiers stay in private scanner records. Connected-player counts exclude offline play and other platforms and are context, not player evidence.
- Optional Twitch and IGDB collection stores aggregate live-audience status and public game metadata. These provider snapshots are context, not reports, confirmations, or proof of an issue.
- Newspaper coverage comes from a separate reviewed source list. Only approved hosts and verified creator videos can appear; discovery results cannot publish themselves there.
- Reddit API access is permanently off. Public Reddit pages can only arrive through ordinary public-web discovery.
- Cloudflare Turnstile is optional spam protection for full reports; player confirmations do not require it on the normal path.
- No accounts, email collection, ads, or analytics trackers are part of the public product.
- Raw IP addresses are not stored; salted one-way network hashes are used only for abuse controls and deduplication.

## Contribution and release boundaries

Contributors can review the UI, schemas, tests, privacy behavior, and public aggregation rules from the repository. A migration file can be reviewed without being applied. Applying a migration or changing a hosted provider remains an owner-authorized release action.

Use the [Contributing guide](../CONTRIBUTING.md) for local checks, the [Operations Guide](OPERATIONS.md) for safe maintainer actions, and the [Launch Checklist](LAUNCH_CHECKLIST.md) for provider setup. The public docs do not replace private credentials, dashboard access, or owner decisions.
