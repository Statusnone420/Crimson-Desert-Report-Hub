# Privacy

Crimson Desert Report Hub is built to collect useful issue evidence without turning into a public dump of unreviewed player complaints.

## What Public Visitors Can See

Public pages may show:

- Aggregate report counts.
- Current official patch title, version, publish time, and Pearl Abyss source link.
- Issue cluster titles and summaries.
- Platform/category counts.
- Public community signal counts.
- Public source links that passed automation thresholds.
- Moderator-approved excerpts from direct reports.

Public pages never intentionally show raw unmoderated player report text.

## What Submitters Provide

The report form can collect:

- Patch version.
- Platform.
- Category.
- Severity and frequency.
- One-line issue title.
- Description of what happened.
- Optional repro steps.
- Optional hardware information.
- Optional evidence URL.
- Optional Pearl Abyss support/PERS reference.

Submissions are anonymous. There is no account system and no email field.

## Local Save/Config Helper

The report page can optionally inspect selected Crimson Desert save/config files in the visitor's browser.

This helper is designed to improve report quality without uploading raw save files:

- Raw files are not uploaded by the helper.
- Small XML/log/text files may be read locally in the browser.
- Binary save files are treated as file metadata only.
- Local folder/account-looking path segments are stripped before generated text is inserted.
- The helper writes only visible sanitized text into normal report fields.
- Visitors can edit or delete that generated text before submitting.

The server receives only the final form submission text.

## IP Handling

The app uses a salted one-way hash of the request IP for spam rate limiting.

It does not store raw IP addresses in the application database.

## Automation Sources

The scanner may read public Pearl Abyss patch-note metadata, public web search results, and optional public Reddit posts. It stores structured summaries and source URLs. Raw source text, when retained for moderator review, is temporary and is purged by scheduled maintenance.

## Admin Data

Admins can see pending report details so they can approve, reject, cluster, or redact public excerpts. Admin access is password-gated and session-cookie based.

## Third Parties

Depending on configured environment variables, the deployment may use:

- Supabase for database storage.
- Vercel for hosting and scheduled jobs.
- Cloudflare Turnstile for spam protection.
- Tavily for web search.
- OpenRouter for structured extraction.
- Reddit API for public subreddit posts.

Provider keys are server-side only.

## Analytics And Ads

This project does not include analytics trackers or advertising code.
