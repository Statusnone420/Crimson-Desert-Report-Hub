# Privacy

Crimson Desert Report Hub is an independent fan site. It has no player accounts, email field, ads, or analytics trackers. It is not affiliated with or endorsed by Pearl Abyss, and it does not provide a support desk or support response.

## What The Public Registers Mean

- **Historical written reports are evidence.** The public free-form report flow is retired. Existing written reports remain under the prior privacy rules; approved historical excerpts may remain public.
- **Check-ins are signals.** Anonymous check-ins record what a network says about a public issue on an exact patch. They are tallies, not identity, consensus, or a verdict.
- **Scanner links are leads.** Public web links found by the scanner may appear as source-radar context or questions. They never become player evidence merely because they passed a filter.
- **Official notes are context.** Pearl Abyss patch metadata and claimed fixes start questions; they do not prove a result on every platform.

## What Public Visitors Can See

Public pages may show:

- Current official patch title, version, publish time, and Pearl Abyss source link.
- Issue titles and neutral summaries.
- Aggregate historical written-report counts and platform/category counts.
- Aggregate check-in counts by response and platform.
- Count-backed labels such as `Community check-ins`, `Earlier player reports`, `Fix claimed — unverified`, `Still happening reported`, or `Fixed for some`. These labels do not establish unique player identities or prove a fix for everyone.
- Public scanner lead links and mapped lead questions.
- Original Crimson Desert Report Hub articles with cited source links.
- Manually reviewed official, press, and creator coverage with a reviewed headline, excerpt, source date, and outbound link.
- Aggregate Steam review sentiment, aggregate Twitch audience, and public IGDB game metadata when those lanes are configured and current.
- Approved historical report excerpts.

Public pages never intentionally show raw unmoderated report text, Steam review text retained for classification, hashed provider identifiers, network hashes, connected-player snapshots, rejected scanner candidates, raw IP addresses, check-in rows, or the check-in-attempt ledger. Pending and skipped video-review candidates, including review notes, stay in private operator storage until a later publication PR adds an approved Watch entry.

## Historical Written Reports

The public free-form report page and API are retired. Existing written reports are preserved for the historical record. Raw historical text remains private unless an excerpt was approved for publication. The retired route redirects visitors to the Issue Board, and its API returns `410 Gone` without reading a payload or calling database, moderation, or provider services.

## Anonymous Check-Ins

The Issue Board accepts anonymous check-ins only for public issues. A platform choice and a Turnstile check are required. The server derives the current exact patch; the browser cannot claim a different patch.

One network has one current response for each issue and exact patch. Choosing another response replaces that network's earlier response for the same issue and patch. People who share a carrier, household, workplace, or other network share that response. Network changes can count separately. Check-in totals therefore do not verify unique players.

The public UI receives aggregates only. The browser may remember a selected response locally, but that marker cannot prove the server's network-deduplication identity and does not author an optimistic public total.

## Network Hashes And Rate Limits

The application does not store raw IP addresses in its database. For check-ins, the server derives a salted one-way hash from the request IP for deduplication and rate limits. It is never sent to public pages.

Check-in writes use an atomic database function. A per-network transaction lock serializes concurrent responses for the same hash. The function checks that the target issue remains public, records an accepted response only when allowed, and updates the current response in the same transaction. The private attempt ledger stores only the network hash and timestamp. Older entries are removed by later check-in processing.

Network hashes are an abuse-control approximation, not identity. Shared networks can undercount and network changes can count separately. This is why check-in tallies never become verdicts.

## Browser-Local Theme

The theme button can store the chosen light or dark theme in the browser's localStorage. The setting is not sent to the server. If browser storage is unavailable, the theme still works for the current visit.

Catch up on Pywel stores a remember preference, last-visit time, and an explicitly marked caught-up time in localStorage (`crimson-catch-up-v1`). These values stay on that browser and are not sent to the server. Visits never mark the edition as read. Turning off “Remember my place on this browser” clears both dates and retains only the disabled preference. Date and patch selections use the URL fragment; copying a catch-up link shares that chosen starting point with its recipient. With storage blocked or memory disabled, readers can still choose a date, patch, or recent highlights.

## Source Radar And AI Providers

The scanner may read public Pearl Abyss patch-note metadata and public web-search results through Tavily. Public-web queries may find `reddit.com` pages, but the project does not use Reddit API credentials or direct subreddit monitoring. For a small number of promising Reddit results whose search snippets are too thin, the scanner may ask Tavily for bounded basic extraction after normalizing the public URL to `old.reddit.com`.

Scanner links remain leads. The app may store structured summaries and source URLs; raw source text retained for maintainer review is temporary and is purged by scheduled maintenance.

High-value scanner enrichment and official fix-claim mapping use bounded server-side provider calls with a saved $0.50 default budget, configurable up to the $1 UTC-month software ceiling, and model-specific per-request price ceilings. The default scanner lane is [GPT-5.6 Luna](https://openrouter.ai/openai/gpt-5.6-luna) Standard through [OpenRouter](https://openrouter.ai/docs/guides/privacy/data-collection), pinned to the first-party OpenAI provider with no automatic provider or model fallback. Luna Flex is an explicit preset on the same provider route. DeepSeek V4 Flash is an explicit maintainer rollback only and retains zero-data-retention routing. [OpenAI does not train on API data by default; abuse-monitoring logs may be retained for up to 30 days.](https://developers.openai.com/api/docs/guides/your-data)

Check-ins use Turnstile and do not call Tavily or an LLM.

The deployment should use a dedicated OpenRouter key with a provider-side monthly or lifetime limit of $1 or lower. Before inference, the scanner inspects the limit, remaining credit, and monthly usage. Daily, weekly, unlimited, or unverifiable limits block AI requests. The provider-key limit is the aggregate ceiling; concurrent runs can slightly exceed a lower app target while staying within that ceiling. These are setup requirements, not a claim that a deployed account is configured or verified.

## Editorial And Platform Sources

Original Crimson Desert Report Hub articles are first-party journalistic work and keep source links with each story. The separate public Atom and RSS 2.0 feeds contain only those original articles. Reviewed external coverage is a separate maintained register. Its official, press, and creator links appear only after source, host, creator-video, date, headline, and excerpt checks. They do not become player evidence or scanner leads, and they do not enter the original-article feeds.

Optional Steam collection reads public review aggregates, bounded review text for private classification, and the public connected-player count. Public pages receive aggregate review history and reviewed leads, not raw review text or provider identifiers. Connected-player snapshots remain service-role records and are not currently rendered publicly. They cover Steam-connected play at capture time and exclude offline play and other platforms.

Optional Twitch and IGDB collection uses server-side application credentials. Public output is limited to aggregate live-stream/viewer context and public game metadata. These snapshots describe provider activity and release/platform context. They do not identify players or prove that an issue exists.

## Admin Data

Admins can read historical report details, claim-mapping exceptions, scanner run data, and rejected lead candidates. Admin access is password-gated and session-cookie based.

Maintainers may moderate historical reports, redact public excerpts, lock a lifecycle display, or force a cluster public or hidden. Visibility overrides do not change the meaning of historical reports, check-ins, or scanner leads.

## Third Parties

Depending on configured environment variables, the deployment may use:

- Supabase for database storage.
- Vercel for hosting and scheduled routes.
- Cloudflare for DNS, the scheduled Worker, and Turnstile on anonymous check-ins.
- Tavily within its 1,000-credit monthly ceiling for public discovery and bounded context extraction.
- Server-side providers for bounded enrichment and low-cost deterministic routine paths.
- Steam for public review aggregates, bounded private review classification, and connected-player snapshots when enabled.
- Twitch and IGDB for aggregate audience context and public game metadata when configured.
- Original publishers and creator channels linked from the manually reviewed newspaper register.

Provider keys are server-side only. The check-in endpoint uses Turnstile, same-origin checks, network-hash deduplication, atomic rate limits, and display thresholds.

## Analytics And Ads

This project does not include analytics trackers or advertising code.
