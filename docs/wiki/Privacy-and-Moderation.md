# Privacy and Moderation

Crimson Desert Report Hub is an independent fan site. It is not affiliated with or endorsed by Pearl Abyss, and it does not provide a support desk or support response.

## Public visitors can see

- Current official patch metadata and links.
- Neutral issue titles and summaries.
- Aggregate historical written-report and anonymous check-in counts.
- Exact-patch fix-claim readouts.
- Reviewed scanner lead links and mapped questions.
- Original Crimson Desert Report Hub articles and cited sources.
- Manually reviewed official, press, and creator coverage.
- Aggregate Steam review, Twitch audience, and IGDB context when configured and current.
- Approved historical report excerpts.

## Public visitors should not see

- Raw unmoderated historical report text.
- Raw IP addresses, network hashes, or individual check-in rows.
- The private check-in-attempt ledger.
- Rejected candidates, private source context, credentials, or admin-only queues.
- Raw Steam review text retained for classification or hashed provider identifiers.
- Connected-player snapshots, which remain service-role records.

## Historical reports, check-ins, and leads

The public free-form report flow is retired. Existing written reports remain in the historical record; raw text stays private unless an excerpt was already approved.

Anonymous check-ins are available only on public issues. The server keeps one current response per network, issue, and exact patch. A later choice replaces that network's earlier response. People sharing a network share one response, so check-in totals do not verify unique players. Turnstile helps limit automated submissions. The database stores no raw IP address; a salted one-way network hash supports replacement and rate limits.

Scanner links are leads. Official notes are context. Historical reports and check-ins are player signals or evidence under their stated rules. None of those categories silently upgrades into another category.

Original Crimson Desert Report Hub articles are first-party journalistic work. Selected press and creator links are reviewed outbound coverage. They remain separate from scanner leads and player evidence. Atom and RSS feeds include original articles only.

## Moderation and visibility

Admins review historical reports, scanner exceptions, and publication state. Auto, Force public, and Force hidden are explicit operator states; they do not change what a historical report, check-in, lead, or official claim means.

## Third parties

Depending on deployment configuration, the project may use Supabase, Vercel, Cloudflare Turnstile, Tavily, OpenRouter, Steam, Twitch, and IGDB. Provider keys stay server-side. Reddit API access is permanently off.

Steam review text used for classification stays private. Public Steam output is aggregate review context. Connected-player snapshots are not currently rendered publicly; they cover Steam-connected play only and exclude offline play and other platforms. Twitch output is aggregate live-audience context. IGDB supplies public game metadata. These provider snapshots do not identify players or prove an issue.

For the complete repository policy, see [Privacy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md) and [Security](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md).
