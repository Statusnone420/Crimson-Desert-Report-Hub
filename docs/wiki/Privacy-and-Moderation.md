# Privacy and Moderation

The hub is public about its privacy and publishing promises while keeping raw submissions and private moderation material out of the public read model.

## Public visitors can see

- Current official patch metadata and links.
- Neutral issue titles and summaries.
- Aggregate report and confirmation counts.
- Patch-scoped fix-claim readouts.
- Reviewed scanner lead links and mapped questions.
- Deliberately approved report excerpts.

## Public visitors should not see

- Raw unmoderated report text.
- Raw IP addresses, network hashes, or individual confirmation rows.
- The private confirmation-attempt ledger.
- Rejected candidates, private source context, credentials, or admin-only queues.

## Reports, signals, and leads

Reports are evidence. One-tap responses are player signals. Scanner links are leads. Official notes are context. None of those categories silently upgrades into another category.

## Anonymous intake

The report form does not require an account or email address. It accepts structured issue details such as patch, platform, category, severity, frequency, reproduction, hardware, and optional evidence. A moderator decides whether a short excerpt is useful and safe to publish.

The browser-side save/config helper reads selected local files without uploading the raw file. It produces editable text in the normal form; only the final submitted fields leave the browser.

## Confirmation and abuse controls

The server scopes responses to the issue and patch family, keeps one current stance per network, and uses salted one-way network hashes for deduplication and rate limits. Shared networks can undercount and changing networks can count separately, so these hashes are an abuse-control approximation—not identity.

The public UI receives aggregates only. The browser may remember the selected response locally, but it does not author an optimistic public total.

## Moderation and visibility

Admins review direct reports, scanner exceptions, and publication state. Auto, Force public, and Force hidden are explicit operator states; they do not change what a report, response, lead, or official claim means.

## Third parties

Depending on deployment configuration, the project may use Supabase, Vercel, Cloudflare, Tavily, OpenRouter, and optional Turnstile. Provider keys stay server-side. Reddit API access is permanently off.

For the complete repository policy, see [Privacy](../PRIVACY.md) and [Security](../../SECURITY.md).
