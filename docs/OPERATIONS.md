# Operations Guide

This guide is for deploying and running Crimson Desert Report Hub without committing secrets.

## Environments

Keep real values in hosting/provider dashboards only:

- Local machine: `.env.local` for development only.
- Vercel: Project Settings -> Environment Variables.
- Supabase: Project dashboard and database migrations.
- GitHub: repository source code only; no API keys, passwords, or `.env` files.

## Required Services

### Supabase

Supabase stores reports, issue clusters, automation runs, source signals, and scanner settings.

Required Vercel env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Important: the service role key must never be exposed in browser code or committed to GitHub.

Apply migrations from `supabase/migrations` in timestamp order. The production migration history must match those filenames for the Supabase GitHub integration to pass.

### Vercel

Vercel hosts the Next.js app and scheduled cron route.

Required Vercel env vars:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CRON_SECRET`
- all Supabase required vars

The scheduled scan runs through `/api/cron/keepalive`. That route requires `Authorization: Bearer <CRON_SECRET>`.

### Turnstile

Cloudflare Turnstile protects the public report form from spam. The site still runs without it, but public submission is safer with it configured.

Vercel env vars:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Add every production hostname to the Turnstile widget's allowed hostnames.

## Optional Automation Providers

### Tavily

Tavily provides general web search results for Crimson Desert issue queries.

Vercel env var:

- `TAVILY_API_KEY`

The app uses small capped searches. The protected preview route can test one search without writing public data.

### OpenRouter

OpenRouter extracts structured issue data from source snippets.

Vercel env vars:

- `OPENROUTER_API_KEY`
- `OPENROUTER_FREE_MODEL=openrouter/free`

Use `openrouter/free` for this project unless the budget and model choice are intentionally changed later.

### Reddit

Reddit is optional but useful for public subreddit monitoring.

You do not need a new public Reddit account for users. Create API credentials from a normal Reddit developer account. If Reddit shows Devvit templates or commands, those are not needed for this website.

Reddit may require explicit Data API access approval before credentials work. Until that is approved, leave the Reddit env vars empty; Tavily web search can still find public web pages, including public Reddit pages, and the dashboard will show Reddit as disabled.

Vercel env vars:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`

Recommended user agent format:

```text
web:crimson-desert-report-hub:v1.0 (by /u/YOUR_REDDIT_USERNAME)
```

## Cost Controls

The main knob is:

```env
AUTOMATION_BUDGET_USD_MONTHLY=5
```

Use `0` to disable paid search and paid LLM work. The scanner will still record skipped work in `automation_runs`.

## Scanner Controls

Admin page:

```text
/admin/source-monitor
```

Controls:

- `Test scan without publishing`: writes only the run ledger.
- `Run capped scan now`: runs the real scanner within the monthly budget.
- `Pause scheduled scans`: stops cron-triggered scanning.
- `Resume scheduled scans`: allows cron-triggered scanning again.

Manual runs are intentionally still available while scheduled scans are paused.

The scanner has a conservative relevance gate before anything is written as a source signal. It rejects broad patch notes, reviews, benchmarks, and `other` category extractions unless there is explicit issue language such as FPS drops, stutter, crash, freeze, input lockups, launch failures, or visual artifacts.

## Admin Access

Admin is currently a single shared password, not named user accounts.

1. Open `/admin/login`.
2. Enter the `ADMIN_PASSWORD` value from Vercel.
3. Use `/admin` for report moderation.
4. Use `/admin/source-monitor` for scanner runs, pause/resume, and recent source signals.
5. Use `/admin/compile` to generate the evidence dossier.

To add another human admin today, give them the admin password through a private channel and rotate `ADMIN_PASSWORD` if access should be revoked. Named admin accounts can be added later with a real auth provider, but they are intentionally not part of this low-friction launch build.

## Safe Live Preview

Use the source preview route to inspect one live search/extraction without database writes:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_DOMAIN/api/cron/source-preview?queries=1"
```

This route is protected by `CRON_SECRET`, capped to at most two search queries, and does not write to Supabase.

## Production Smoke Test

After deploy:

1. Visit `/`, `/issues`, `/report`, and `/about`.
2. Log in at `/admin/login`.
3. Open `/admin/source-monitor`.
4. Run `Test scan without publishing`.
5. Run the protected source preview route with `queries=1`.
6. Only run `Run capped scan now` after the preview output looks relevant.

## Secret Hygiene

Before pushing:

```bash
git status --short
git diff --cached
```

Also search for accidental secrets:

```bash
rg -n "sb_secret|sk-or-|tvly-|SUPABASE_SERVICE_ROLE_KEY|OPENROUTER_API_KEY|TAVILY_API_KEY" .
```

Expected result: only placeholder names in documentation and `.env.local.example`, never real key values.
