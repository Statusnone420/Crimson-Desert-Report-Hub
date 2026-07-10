# Privacy and Moderation

The hub collects useful issue evidence and player signals without becoming a public dump of raw complaints or a user-tracking system.

## Public Visitors Can See

- Official patch metadata and source links.
- Neutral issue titles and summaries.
- Aggregate structured-report counts.
- Aggregate confirmation counts by stance and platform.
- Count-backed readout labels and patch-family fix polls.
- Scanner lead links and mapped lead questions.
- Moderator-approved excerpts from direct reports.

## Public Visitors Should Not See

- Raw unmoderated report text.
- Raw IP addresses or salted network hashes.
- Individual confirmation rows or the confirmation-attempt ledger.
- Private support tickets.
- Credentials or environment values.
- Admin-only moderation and rejected-lead details.

## Reports, Signals, And Leads

- Structured player reports are evidence.
- One-tap confirmations are player signals, not consensus or a verdict.
- Scanner-discovered links are leads, even when visible.
- Official Pearl Abyss notes are canonical patch context, not proof of player outcomes.

## Direct Reports

Player submissions are anonymous. The app does not require player accounts or email addresses. Raw report text stays private unless a moderator deliberately approves a short excerpt.

## One-Tap Confirmations

Confirmations store issue, patch family/version, platform, stance, timestamp, and a salted one-way network hash. One network gets one current stance per issue per patch family. A later tap updates that stance instead of creating another counted voice.

If a confidently mapped official fix starts a clock, the hub stores the exact claimed patch version. Only `Still happening` and `Fixed for me` taps at or after the clock answer the poll while that exact patch is current. A `1.13.00` claim cannot be attributed to `1.13.01`, and only exact-version post-clock reports count as post-claim report evidence. Scanner URLs always remain leads. Public totals come from server aggregates; local browser state remembers only the selected stance and never invents an optimistic count.

## IP And Abuse Protection

The application database does not store raw IP addresses. The server derives salted one-way hashes for report rate limiting and confirmation deduplication.

Confirmation writes run through an atomic database function. It serializes concurrent writes per network hash, checks that the issue is still public, records the accepted write in a private hash-and-timestamp ledger, and rejects writes after 20 for that hash in a trailing hour. Its outcomes are `recorded`, `rate_limited`, or `unknown_issue`. Old ledger entries are removed when later confirmations are processed. Hashes and row-level data never reach public pages.

Shared networks can undercount and changing networks can count separately, so tallies remain explicitly limited signals rather than identity or verdicts.

## Local Save/Config Helper

The report page can inspect selected local Crimson Desert files in the browser to help players fill report fields. Raw files are not uploaded by that helper. Players can edit or delete generated text before submitting.

## Moderation And Overrides

Admins review pending direct reports before approving public excerpts. Claim-mapping exceptions and explicit lifecycle locks appear in the admin exceptions view.

Maintainers can set cluster visibility to `Auto`, `Force public`, or `Force hidden`. Forced visibility takes effect atomically through a service-role RPC, and database triggers preserve it across concurrent scanner writes. The automatic baseline stays current while forced; `Auto` restores it and immediately re-runs a revision-checked, atomic promotion refresh for current reports and source rows. Public pages refresh after the action. An override does not change the meaning of reports, confirmations, or scanner leads.

## Provider Boundaries

Tavily searches the public web within a 1,000-credit monthly ceiling. Public Reddit pages may appear in Tavily results, and promising thin Reddit results may receive bounded Tavily basic extraction after their URL is normalized to `old.reddit.com`; Reddit API and direct subreddit monitoring remain permanently off.

High-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash`, under a hard $2 UTC-month software cap and per-request price ceilings. Routine report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback. A dedicated OpenRouter key should also have a provider-side monthly reset limit of $2 or lower; maintainers must configure and verify that dashboard setting because the repository cannot. Confirmation taps call neither provider and do not use a captcha on the happy path.

## Security Reports

Do not post exploit details or secrets in public issues or discussions. Use the repository security policy:

[SECURITY.md](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)
