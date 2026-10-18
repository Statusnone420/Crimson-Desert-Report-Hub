# Security Policy

## Reporting a vulnerability

Please do not open a public issue with exploit details, secrets or private data.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainer can read the report.

Useful reports include:

- The affected route or file.
- The impact.
- Reproduction steps that use test data only.
- A suggested fix, if you have one.

## Secret handling

Never commit:

- Supabase service role keys.
- OpenRouter, Tavily, Cloudflare, Turnstile or Vercel tokens and secrets.
- `.env.local` or any other real environment file.
- Screenshots that show credentials.
- Private dashboard URLs that reveal sensitive project details.

## Supported version

Only the current `main` branch is supported.

## Security model

- Browser code never receives the Supabase service role key.
- Server routes and actions access Supabase tables. Public table access is denied through row-level security and revoked grants.
- Cron and preview routes require `CRON_SECRET`. Admin routes require a signed session cookie. A session lasts 30 days and renews itself with use; "Sign out everywhere" in the operator menu ends every session at once. Admin sign-in attempts are rate-limited per network.
- Public report text is moderation-gated before it appears in public.
- The database stores salted one-way network hashes, never raw IP addresses. An IPv6 address counts by its /64 network.
- Check-in writes use a service-role-only database function. It takes the shared visibility lock, then cluster and network locks, rechecks public issue visibility in the same transaction, and enforces a limit of 20 attempts per network per hour.
- Each verified Turnstile token can save one check-in or one problem report. The database keeps a SHA-256 hash of the token, never the token, so a replayed token is refused.
- Private problem reports, confirmation hashes, attempt rows and individual check-ins never reach public pages; only aggregates do.
- The Reddit API is permanently off. Public Reddit pages can enter only as ordinary web-discovery leads.
