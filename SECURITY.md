# Security Policy

## Reporting A Vulnerability

Please do not open a public issue with exploit details, secrets, or private data.

Report security concerns through GitHub's private vulnerability reporting flow if available for this repository. If that is not available, open a minimal issue that says you have a security report and avoid including sensitive details.

Useful reports include:

- Affected route or file.
- Impact.
- Reproduction steps using test data only.
- Suggested fix, if known.

## Secret Handling

Never commit:

- Supabase service role keys.
- OpenRouter, Tavily, Cloudflare, or Vercel tokens.
- `.env.local` or other real environment files.
- Screenshots that show credentials.
- Private dashboard URLs that reveal sensitive project details.

## Supported Version

Only the current `main` branch is supported.

## Security Model

- Browser code never receives the Supabase service role key.
- Supabase tables are accessed by server routes/actions.
- Public table access is denied through RLS and revoked grants.
- Cron and preview routes require `CRON_SECRET`.
- Admin routes require a signed session cookie.
- Public report text is moderation-gated before appearing publicly.
- The application database stores salted one-way network hashes, not raw IP addresses.
- Confirmation writes use a service-role-only database function that first takes the shared visibility transaction lock, then cluster/network locks, rechecks public issue visibility in-transaction, and enforces the 20-writes-per-hour hashed attempt ledger.
- Confirmation hashes, attempt rows, and individual confirmation records never reach public pages; only aggregates do.
- Reddit API is permanently off; public Reddit pages may enter only as Tavily-discovered web leads.
