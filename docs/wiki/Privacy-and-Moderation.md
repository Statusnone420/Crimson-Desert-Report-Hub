# Privacy and Moderation

The hub is public about its privacy and publishing promises while keeping raw submissions and private moderation material out of the public read model.

## Public visitors can see

- Current official patch metadata and links.
- Neutral issue titles and summaries.
- Aggregate report and confirmation counts.
- Patch-scoped fix-claim readouts.
- Reviewed scanner lead links and mapped questions.
- Original Report Hub articles and their cited sources.
- Manually reviewed official, press, and creator coverage.
- Aggregate Steam review, Twitch audience, and IGDB context when configured and current.
- Deliberately approved report excerpts.

## Public visitors should not see

- Raw unmoderated report text.
- Raw IP addresses, network hashes, or individual confirmation rows.
- The private confirmation-attempt ledger.
- Rejected candidates, private source context, credentials, or admin-only queues.
- Raw Steam review text retained for classification or hashed provider identifiers.
- Connected-player snapshots, which remain service-role records.

## Reports, signals, and leads

Reports are evidence. One-tap responses are player signals. Scanner links are leads. Official notes are context. None of those categories silently upgrades into another category.

Original Report Hub articles are first-party editorial work. Selected press and creator links are reviewed outbound coverage. They remain separate from scanner leads and player evidence. Atom and RSS feeds include original articles only.

## Anonymous intake

The report form does not require an account or email address. It accepts structured issue details such as patch, platform, category, severity, frequency, reproduction, hardware, and optional evidence. A moderator decides whether a short excerpt is useful and safe to publish.

Evidence is supplied through an optional link. The form does not inspect local files or offer save/config uploads.

## Confirmation and abuse controls

The server scopes responses to the issue and patch family, keeps one current stance per network, and uses salted one-way network hashes for deduplication and rate limits. Shared networks can undercount and changing networks can count separately, so these hashes are an abuse-control approximation—not identity.

The public UI receives aggregates only. The browser may remember the selected response locally, but it does not author an optimistic public total.

## Moderation and visibility

Admins review direct reports, scanner exceptions, and publication state. Auto, Force public, and Force hidden are explicit operator states; they do not change what a report, response, lead, or official claim means.

## Third parties

Depending on deployment configuration, the project may use Supabase, Vercel, Cloudflare, Tavily, OpenRouter, Steam, Twitch, IGDB, and optional Turnstile. Provider keys stay server-side. Reddit API access is permanently off.

Steam review text used for classification stays private. Public Steam output is aggregate review context. Connected-player snapshots are not currently rendered publicly; they cover Steam-connected play only and exclude offline play and other platforms. Twitch output is aggregate live-audience context. IGDB supplies public game metadata. These provider snapshots do not identify players or prove an issue.

For the complete repository policy, see [Privacy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md) and [Security](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md).
