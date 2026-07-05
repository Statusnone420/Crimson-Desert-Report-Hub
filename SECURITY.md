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
- OpenRouter, Tavily, Reddit, Cloudflare, or Vercel tokens.
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
