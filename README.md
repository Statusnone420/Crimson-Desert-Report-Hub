# Crimson Desert Report Hub

Unofficial, fan-run community tracker for Crimson Desert patch issues. It turns structured, moderated community reports into evidence Pearl Abyss can act on.

- No accounts, no ads, no analytics trackers.
- Anonymous submissions, moderation-gated public data.
- Not affiliated with Pearl Abyss, Reddit, or X.
- Public source is intentional for transparency, privacy review, and community contributions.

## Stack

Next.js App Router, Supabase Postgres with deny-all RLS and server-only access, Vercel, and Cloudflare Turnstile.

Optional, fail-closed features:

- Groq or OpenRouter dossier drafting.
- Reddit OAuth source monitor.
- xAI/X search flag only; no paid runner is implemented.

## Development

```bash
cp .env.local.example .env.local
npm install
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`.

## Environment

See `.env.local.example`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Recommended:

- `CRON_SECRET`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Optional:

- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`
- `XAI_API_KEY`

Do not commit real `.env*` files. They are ignored by default; `.env.local.example` is the only environment file intended for source control.

## Privacy Model

Public pages show only aggregate counts, issue-cluster metadata, and moderator-approved excerpts. Raw unmoderated report text never appears publicly.

The server stores a salted one-way hash of submitter IPs for spam rate limiting. Raw IPs are not stored. Source-monitor raw text is retained only for short moderator review and purged by the daily cron after the configured 48-hour window; retained summaries avoid copying raw body text.

## Deployment

1. Apply Supabase migrations in `supabase/migrations`.
2. Configure Vercel environment variables from `.env.local.example`.
3. Deploy the Next.js project to Vercel.
4. Add the production hostname to Cloudflare Turnstile.
5. Verify `/api/cron/keepalive` is scheduled in Vercel Cron Jobs.

## Public Launch Checklist

Before announcing publicly:

- Set the GitHub repository visibility to public.
- Confirm no real `.env*`, deployment secrets, Supabase service keys, screenshots with credentials, or private drive links are committed.
- Confirm the footer source-code link points to the public repository.
- Recheck Pearl Abyss fan-content guidance before adding any game artwork, logos, or visual branding beyond plain text.
- Confirm the global footer disclaimer renders on every page.
- Confirm `/about` matches the implemented privacy behavior.
- Ask subreddit moderators before posting. Suggested starting point:

```text
Hi mods, I built an unofficial, non-commercial community tracker for patch issues: structured anonymous reports, moderated before anything goes public, compiled into a report Pearl Abyss can use. No ads, no accounts, no data collection beyond the reports themselves. Would you be open to me posting it, and if the community finds it useful, would you consider adding it to the sidebar/wiki? Happy to adjust anything based on your feedback. Link: https://<project>.vercel.app
```

After mod approval, launch it as a place to see whether other players are hitting the same issue, not as a complaint site. Include a dashboard screenshot and ask reporters to include hardware details.
