# Privacy

Crimson Desert Report Hub collects useful issue evidence and player signals without becoming a public dump of complaints or a user-tracking system. It has no player accounts, email field, ads, or analytics trackers.

## What The Public Registers Mean

- **Reports are evidence.** Structured player reports are the strongest input. Raw report text stays private unless a moderator deliberately approves a short excerpt.
- **Confirmations are signals.** One-tap responses count what players say for an issue, platform, and patch family. They are tallies, not identity, consensus, or a verdict.
- **Scanner links are leads.** Public web links found by the scanner may be shown as source-radar context or questions. They never become player evidence merely because they passed a filter.
- **Official notes are context.** Pearl Abyss patch metadata and claimed fixes start questions; they do not prove the result on every platform.

## What Public Visitors Can See

Public pages may show:

- Current official patch title, version, publish time, and Pearl Abyss source link.
- Issue titles and neutral summaries.
- Aggregate structured-report counts and platform/category counts.
- Aggregate confirmation counts by stance and platform.
- Count-backed labels such as `Player-reported` (one counted voice), `Confirmed by players` (two or more counted voices), `Fix claimed — unverified`, or `Players say fixed` when their documented thresholds are met.
- Public scanner lead links and mapped lead questions.
- Moderator-approved excerpts from direct reports.

Public pages never intentionally show raw unmoderated report text, IP addresses, IP hashes, confirmation rows, or the confirmation-attempt ledger.

## Structured Reports

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

Submissions are anonymous. There is no player account system and no email field. Raw submissions remain available to maintainers for moderation; public pages use aggregate counts, neutral summaries, and deliberately approved excerpts.

## One-Tap Confirmations

The issue board and mapped source-radar questions can accept three enum-only responses:

- `I have this too`
- `Still happening`
- `Fixed for me`

A platform choice is required. The server derives the current patch and patch family; the browser cannot claim a different patch.

The database stores the issue ID, patch family, exact patch version, platform, stance, timestamp, and a salted one-way network hash. One network gets one current voice per issue per patch family. Tapping again updates that voice—stance, platform, exact patch, and timestamp—instead of creating another counted voter. This lets someone change from `Still happening` to `Fixed for me`, or back again.

After a successful tap, the browser may remember the selected stance, but that local marker cannot prove the server's network-dedup identity. It never authors an optimistic total; public counts and the fix-poll strip come from server aggregates.

One-network tallies remain visible as early, dim counts. Stronger labels and filled meters require at least two distinct network hashes in the tally that drives them.

When Pearl Abyss makes a confidently mapped fix claim, the hub stores the exact claimed patch version and starts its clock. The fix poll is shown only while that exact patch is current, so a `1.13.00` claim cannot be attributed to `1.13.01`. Only `Still happening` and `Fixed for me` taps made at or after the clock answer the poll. Only structured reports explicitly filed for that exact patch and submitted after the clock count as post-claim report evidence; scanner links always remain leads.

## Network Hashes And Atomic Rate Limits

The application does not store raw IP addresses in its database.

For reports and confirmations, the server derives a salted one-way hash from the request IP. Confirmation hashes support one-voice deduplication and distinct-network display thresholds. They are never sent to public pages.

Confirmation writes use one atomic database function:

1. A per-network transaction lock serializes concurrent taps for the same hash.
2. The function checks inside the transaction that the target issue still exists and is public; otherwise it returns `unknown_issue` without writing a stance or rate-ledger entry.
3. A private attempt ledger counts accepted writes in the trailing hour.
4. At 20 writes for that hash in the trailing hour, the next write returns `rate_limited`.
5. If allowed, the ledger entry and stance upsert happen in the same transaction and return `recorded`.

The attempt ledger stores only the network hash and timestamp. Entries older than one hour are deleted when the function processes a later confirmation. The table and function are denied to public, anonymous, and authenticated database roles; the server service role is the only caller.

Network hashes are an abuse-control approximation, not identity. Shared carrier or household networks can undercount, while network changes can count separately. This is why confirmation tallies never become verdicts.

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

## Source Radar And AI Providers

The scanner may read public Pearl Abyss patch-note metadata and public web-search results through Tavily. Search packs may find public `reddit.com` pages, but the project does not use Reddit API credentials or direct subreddit monitoring. For a small number of promising Reddit results whose search snippets are too thin, the scanner may ask Tavily for bounded basic extraction after normalizing the public URL to `old.reddit.com`.

Scanner links remain leads. The app may store structured summaries and source URLs; raw source text retained for maintainer review is temporary and is purged by scheduled maintenance.

High-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash`, with a hard $2 UTC-month software cap and per-request price ceilings. Routine report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback. Confirmations do not call Tavily, an LLM, or a captcha service on the happy path.

The deployment should use a dedicated OpenRouter key with a provider-side monthly limit of $2 or lower that resets monthly. That dashboard setting is a maintainer setup and verification step; the repository cannot inspect it and does not claim it is already configured.

## Admin Data

Admins can see pending report details, claim-mapping exceptions, scanner run data, and rejected lead candidates. Admin access is password-gated and session-cookie based.

Maintainers may approve/reject reports, redact public excerpts, lock a lifecycle display, or force a cluster public/hidden. Forced visibility takes effect atomically through a service-role RPC, database triggers preserve it across concurrent scanner writes, and public surfaces are refreshed. The automatic baseline stays current while an override is active; `Auto` restores it and immediately re-runs a revision-checked, atomic promotion refresh for current reports and source rows. Overrides do not change the meaning of reports, confirmations, or scanner leads.

## Third Parties

Depending on configured environment variables, the deployment may use:

- Supabase for database storage.
- Vercel for hosting and scheduled routes.
- Cloudflare for DNS, the scheduled Worker, and optional Turnstile protection on the full report form.
- Tavily within its 1,000-credit monthly ceiling for public discovery and bounded context extraction.
- OpenRouter for the $2-capped DeepSeek automation lane and free/deterministic routine AI lane described above.

Provider keys are server-side only. The confirmation endpoint does not use Turnstile; it accepts enum-only input and relies on same-origin checks, network-hash deduplication, the atomic rate ledger, and display thresholds.

## Analytics And Ads

This project does not include analytics trackers or advertising code.
